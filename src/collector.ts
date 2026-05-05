/**
 * TelemetryCollector — central data store for usage, tokens, cost, errors, timing.
 *
 * Maintains per-package and per-tool telemetry with rolling-window p95 timing.
 * Supports snapshot/restore for session persistence.
 */

import type {
	PackageTelemetry,
	SessionTelemetry,
	ToolTelemetry,
	PackageErrorEntry,
	DomainEvent,
	MetricEntry,
	MetricSummary,
} from "./types.ts";
import { MAX_ERROR_HISTORY, MAX_DOMAIN_EVENTS } from "./types.ts";

// ── Constants ───────────────────────────────────────────────────────────

/** Max execution times kept per tool (rolling window) */
const MAX_EXECUTION_TIMES = 100;

/** Default cost per 1M input tokens (USD) — fallback when model cost unknown */
const DEFAULT_INPUT_COST_PER_1M = 3.0;

/** Default cost per 1M output tokens (USD) — fallback when model cost unknown */
const DEFAULT_OUTPUT_COST_PER_1M = 15.0;

// ── Helpers ─────────────────────────────────────────────────────────────

function createToolTelemetry(): ToolTelemetry {
	return {
		invocations: 0,
		errors: 0,
		avgDurationMs: 0,
		p95DurationMs: 0,
		maxDurationMs: 0,
		executionTimes: [],
	};
}

function createPackageTelemetry(name: string, version: string): PackageTelemetry {
	return {
		name,
		version,
		totalInvocations: 0,
		totalErrors: 0,
		errorRate: 0,
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		totalTokens: 0,
		estimatedCost: 0,
		totalExecutionMs: 0,
		avgExecutionMs: 0,
		maxExecutionMs: 0,
		tools: {},
		lastHeartbeat: 0,
		status: "healthy",
		errorHistory: [],
	};
}

function computeP95(times: number[]): number {
	if (times.length === 0) return 0;
	const sorted = [...times].sort((a, b) => a - b);
	const index = Math.ceil(sorted.length * 0.95) - 1;
	return sorted[Math.max(0, index)];
}

function computeErrorRate(errors: number, invocations: number): number {
	if (invocations === 0) return 0;
	return errors / invocations;
}

// ── Collector ───────────────────────────────────────────────────────────

export class TelemetryCollector {
	private readonly packages = new Map<string, PackageTelemetry>();
	private readonly events: DomainEvent[] = [];
	private readonly metrics = new Map<string, MetricEntry[]>();
	private sessionStart = Date.now();
	private sessionEnd: number | undefined;

	// ── Public API ──────────────────────────────────────────────────────

	/**
	 * Record a tool invocation for a package.
	 */
	recordToolInvocation(pkgName: string, tool: string): void {
		const pkg = this.getOrCreate(pkgName, "0.0.0");
		pkg.totalInvocations++;
		pkg.tools[tool] ??= createToolTelemetry();
		pkg.tools[tool].invocations++;
		// Ensure error rate is recalculated
		pkg.errorRate = computeErrorRate(pkg.totalErrors, pkg.totalInvocations);
	}

	/**
	 * Record a tool result with duration and error status.
	 */
	recordToolResult(pkgName: string, tool: string, duration: number, isError: boolean): void {
		const pkg = this.getOrCreate(pkgName, "0.0.0");

		if (isError) {
			pkg.totalErrors++;
			pkg.tools[tool] ??= createToolTelemetry();
			pkg.tools[tool].errors++;
		}

		// Update per-tool timing
		const toolTlm = pkg.tools[tool] ??= createToolTelemetry();
		toolTlm.executionTimes.push(duration);
		if (toolTlm.executionTimes.length > MAX_EXECUTION_TIMES) {
			toolTlm.executionTimes.shift();
		}
		toolTlm.avgDurationMs = toolTlm.executionTimes.reduce((a, b) => a + b, 0) / toolTlm.executionTimes.length;
		toolTlm.p95DurationMs = computeP95(toolTlm.executionTimes);
		toolTlm.maxDurationMs = Math.max(toolTlm.maxDurationMs, duration);

		// Update per-package timing
		pkg.totalExecutionMs += duration;
		pkg.maxExecutionMs = Math.max(pkg.maxExecutionMs, duration);

		// Recalculate averages
		pkg.avgExecutionMs = pkg.totalInvocations > 0
			? pkg.totalExecutionMs / pkg.totalInvocations
			: 0;
		pkg.errorRate = computeErrorRate(pkg.totalErrors, pkg.totalInvocations);
	}

	// ── Domain Events ───────────────────────────────────────────────────

	/**
	 * Record a structured domain event (non-tool activity).
	 */
	recordEvent(pkgName: string, type: string, label: string, data?: Record<string, unknown>): void {
		const event: DomainEvent = {
			package: pkgName,
			type,
			label,
			timestamp: Date.now(),
			data,
		};
		this.events.push(event);
		if (this.events.length > MAX_DOMAIN_EVENTS) {
			this.events.splice(0, this.events.length - MAX_DOMAIN_EVENTS);
		}
	}

	/**
	 * Get all domain events, optionally filtered by package and/or type.
	 */
	getEvents(pkgName?: string, type?: string): DomainEvent[] {
		let result = this.events;
		if (pkgName) result = result.filter(e => e.package === pkgName);
		if (type) result = result.filter(e => e.type === type);
		return result;
	}

	// ── Metrics ───────────────────────────────────────────────────────

	/**
	 * Record a numeric metric value.
	 */
	recordMetric(name: string, value: number, opts?: { cumulative?: boolean; tags?: Record<string, string> }): void {
		const entry: MetricEntry = {
			name,
			value,
			timestamp: Date.now(),
			tags: opts?.tags,
			cumulative: opts?.cumulative ?? false,
		};
		const existing = this.metrics.get(name);
		if (existing) {
			existing.push(entry);
		} else {
			this.metrics.set(name, [entry]);
		}
	}

	/**
	 * Get all metric values for a given name.
	 */
	getMetrics(name: string): MetricEntry[] {
		return this.metrics.get(name) ?? [];
	}

	/**
	 * Get all metric names.
	 */
	getMetricNames(): string[] {
		return [...this.metrics.keys()];
	}

	/**
	 * Compute aggregated summary for all metrics.
	 */
	getMetricSummaries(): MetricSummary[] {
		const summaries: MetricSummary[] = [];
		for (const [name, entries] of this.metrics) {
			if (entries.length === 0) continue;
			const total = entries.reduce((s, e) => s + e.value, 0);
			const values = entries.map(e => e.value);
			summaries.push({
				name,
				total,
				average: total / entries.length,
				min: Math.min(...values),
				max: Math.max(...values),
				count: entries.length,
				lastValue: values[values.length - 1],
				cumulative: entries[0]!.cumulative,
			});
		}
		return summaries.sort((a, b) => b.count - a.count);
	}

	/**
	 * Record token attribution for a package.
	 */
	recordTokens(
		pkgName: string,
		tokens: { input: number; output: number; cacheRead?: number; cacheWrite?: number },
	): void {
		const pkg = this.getOrCreate(pkgName, "0.0.0");
		pkg.inputTokens += tokens.input;
		pkg.outputTokens += tokens.output;
		pkg.cacheReadTokens += tokens.cacheRead ?? 0;
		pkg.cacheWriteTokens += tokens.cacheWrite ?? 0;
		pkg.totalTokens = pkg.inputTokens + pkg.outputTokens + pkg.cacheReadTokens + pkg.cacheWriteTokens;
	}

	/**
	 * Record cost attribution for a package.
	 */
	recordCost(pkgName: string, cost: number): void {
		const pkg = this.getOrCreate(pkgName, "0.0.0");
		pkg.estimatedCost += cost;
	}

	/**
	 * Record an error for a package with error history.
	 */
	recordError(pkgName: string, type: string, message: string, stack?: string): void {
		const pkg = this.getOrCreate(pkgName, "0.0.0");
		pkg.totalErrors++;
		const now = Date.now();
		pkg.lastError = {
			type,
			message,
			timestamp: now,
			count: (pkg.lastError?.count ?? 0) + 1,
		};

		// Append to error history, capped at MAX_ERROR_HISTORY
		const entry: PackageErrorEntry = { type, message, timestamp: now, stack };
		pkg.errorHistory.push(entry);
		if (pkg.errorHistory.length > MAX_ERROR_HISTORY) {
			pkg.errorHistory = pkg.errorHistory.slice(-MAX_ERROR_HISTORY);
		}

		pkg.errorRate = computeErrorRate(pkg.totalErrors, pkg.totalInvocations);
	}

	/**
	 * Update version info (set when package registers).
	 */
	setVersion(pkgName: string, version: string): void {
		const pkg = this.getOrCreate(pkgName, version);
		pkg.version = version;
	}

	/**
	 * Update heartbeat info.
	 */
	setHeartbeat(pkgName: string, timestamp: number, status: "healthy" | "degraded" | "error" | "stale"): void {
		const pkg = this.getOrCreate(pkgName, "0.0.0");
		pkg.lastHeartbeat = timestamp;
		pkg.status = status;
	}

	/**
	 * Get or create a package telemetry entry.
	 */
	getOrCreate(pkgName: string, version: string): PackageTelemetry {
		let pkg = this.packages.get(pkgName);
		if (!pkg) {
			pkg = createPackageTelemetry(pkgName, version);
			this.packages.set(pkgName, pkg);
		}
		return pkg;
	}

	/**
	 * Get a snapshot of all telemetry data for the current session.
	 */
	getSnapshot(): SessionTelemetry {
		const packages: Record<string, PackageTelemetry> = {};
		let totalTokens = 0;
		let totalCost = 0;
		let totalInvocations = 0;
		let totalErrors = 0;

		for (const [name, pkg] of this.packages) {
			packages[name] = { ...pkg, tools: { ...pkg.tools }, errorHistory: [...pkg.errorHistory] };
			totalTokens += pkg.totalTokens;
			totalCost += pkg.estimatedCost;
			totalInvocations += pkg.totalInvocations;
			totalErrors += pkg.totalErrors;
		}

		// Build metrics snapshot: latest value per metric name
		const metricsSnapshot: Record<string, MetricEntry[]> = {};
		for (const [name, entries] of this.metrics) {
			metricsSnapshot[name] = [...entries];
		}

		return {
			sessionStart: this.sessionStart,
			sessionEnd: this.sessionEnd,
			packages,
			events: [...this.events],
			metrics: metricsSnapshot,
			totalTokens,
			totalCost,
			totalInvocations,
			totalErrors,
		};
	}

	/**
	 * Export snapshot as formatted JSON.
	 */
	exportJSON(): string {
		return JSON.stringify(this.getSnapshot(), null, 2);
	}

	/**
	 * Restore state from a snapshot (merges into existing data).
	 */
	fromSnapshot(snapshot: SessionTelemetry): void {
		if (snapshot.sessionStart < this.sessionStart) {
			this.sessionStart = snapshot.sessionStart;
		}
		// Restore sessionEnd from snapshot if present
		if (snapshot.sessionEnd !== undefined && (this.sessionEnd === undefined || snapshot.sessionEnd > this.sessionEnd)) {
			this.sessionEnd = snapshot.sessionEnd;
		}

		for (const [name, pkgData] of Object.entries(snapshot.packages)) {
			const existing = this.packages.get(name);
			if (!existing) {
				this.packages.set(name, { ...pkgData, tools: { ...pkgData.tools } });
			} else {
				// Merge: prefer existing counts (they're more recent)
				existing.totalInvocations = Math.max(existing.totalInvocations, pkgData.totalInvocations);
				existing.totalErrors = Math.max(existing.totalErrors, pkgData.totalErrors);
				existing.inputTokens = Math.max(existing.inputTokens, pkgData.inputTokens);
				existing.outputTokens = Math.max(existing.outputTokens, pkgData.outputTokens);
				existing.estimatedCost = Math.max(existing.estimatedCost, pkgData.estimatedCost);
				existing.totalTokens = existing.inputTokens + existing.outputTokens + existing.cacheReadTokens + existing.cacheWriteTokens;
			}
		}
	}

	/**
	 * Record session end timestamp. Actually sets sessionEnd now.
	 */
	recordSessionEnd(): void {
		this.sessionEnd = Date.now();
	}

	/**
	 * Reset all telemetry data.
	 */
	reset(): void {
		this.packages.clear();
		this.events.length = 0;
		this.metrics.clear();
		this.sessionStart = Date.now();
	}

	/**
	 * Get session start timestamp.
	 */
	getSessionStart(): number {
		return this.sessionStart;
	}
}
