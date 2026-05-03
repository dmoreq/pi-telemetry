/**
 * pi-telemetry — Monitoring and telemetry framework for pi extensions.
 *
 * Entry point. Registers the telemetry extension, hooks into session lifecycle,
 * and provides a public API for other extensions.
 *
 * Auto-tracking: pi-telemetry hooks tool_call and tool_result events to
 * automatically track every tool invocation, timing, and error — even for
 * extensions that never call register(). Explicit register() calls enable
 * named attribution, heartbeat health, badge notifications, and per-tool
 * breakdowns in the dashboard.
 *
 * Usage:
 *   import telemetry from "pi-telemetry";
 *   export default function (pi) { telemetry(pi); }
 *
 * Other extensions can import getTelemetry() to access registry/collector:
 *   import { getTelemetry } from "pi-telemetry";
 *   const t = getTelemetry();
 *   t?.register({ name: "my-ext", version: "1.0.0", description: "..." });
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { PackageRegistry } from "./registry.ts";
import { TelemetryCollector } from "./collector.ts";
import { MessageBus } from "./bus.ts";
import { registerTelemetryMessageRenderer, notify } from "./renderer.ts";
import { registerTelemetryWidget } from "./widget.ts";
import { registerTelemetryCommands } from "./commands.ts";
import type {
	PackageRegistration,
	PackageStatus,
	NotifyOptions,
} from "./types.ts";

// ── Module-level singleton ──────────────────────────────────────────────

let instance: Telemetry | null = null;

/**
 * Get the active Telemetry instance. Returns null if not yet initialized
 * or if the session is in a non-telemetry profile.
 */
export function getTelemetry(): Telemetry | null {
	return instance;
}

// ── Constants ──────────────────────────────────────────────────────────

/** Fallback package name for tool calls not claimed by any registered package. */
const ACTIVITY_PACKAGE = "activity";

/** Built-in tool names owned by the pi runtime (not by any extension). */
const BUILTIN_TOOLS = new Set([
	"read", "bash", "edit", "write", "search", "grep", "find", "ls",
]);

// ── Telemetry Class ─────────────────────────────────────────────────────

export class Telemetry {
	public readonly registry: PackageRegistry;
	public readonly collector: TelemetryCollector;
	public readonly bus: MessageBus;
	private readonly pi: ExtensionAPI;
	/** Maps tool name → registered package name (built from registry on heartbeat) */
	private toolToPackage: Map<string, string> = new Map();
	/** Tracks tool call start times for duration computation */
	private toolCallTimestamps: Map<string, number> = new Map();
	/** Cache of tool names seen in the current turn, for cost attribution */
	private turnToolNames: string[] = [];

	constructor(pi: ExtensionAPI) {
		this.pi = pi;
		this.registry = new PackageRegistry();
		this.collector = new TelemetryCollector();
		this.bus = new MessageBus(pi.events);

		// Register UI components
		registerTelemetryMessageRenderer(pi);
		registerTelemetryWidget(pi, this.registry);
		registerTelemetryCommands(pi, this.registry, this.collector);

		// Auto-track every tool call
		pi.on("tool_call", (_event, _ctx) => {
			this.handleToolCall(_event);
		});

		// Auto-track every tool result (timing, errors)
		pi.on("tool_result", (_event, _ctx) => {
			this.handleToolResult(_event);
		});

		// Track turn boundaries for accurate per-turn attribution
		pi.on("turn_start", () => {
			this.turnToolNames = [];
		});

		// Hook into message_end for token/cost attribution
		pi.on("message_end", (_event, _ctx) => {
			this.handleMessageEnd(_event);
		});

		// Reset on new session
		pi.on("session_start", () => {
			this.collector.reset();
			this.toolToPackage.clear();
			this.toolCallTimestamps.clear();
			this.turnToolNames = [];
		});

		// Record session end on shutdown
		pi.on("session_shutdown", () => {
			this.collector.recordSessionEnd();
		});
	}

	// ── Public API ─────────────────────────────────────────────────────

	/**
	 * Register a package. Should be called during extension load.
	 * Automatically maps the package's tools for attribution.
	 */
	register(pkg: PackageRegistration): void {
		this.registry.register(pkg);
		this.collector.setVersion(pkg.name, pkg.version);

		// Map each registered tool to this package
		for (const tool of pkg.tools ?? []) {
			this.toolToPackage.set(tool, pkg.name);
		}
	}

	/**
	 * Deregister a package and unmap its tools.
	 */
	deregister(name: string): void {
		const pkg = this.registry.get(name);
		if (pkg) {
			for (const tool of pkg.tools ?? []) {
				this.toolToPackage.delete(tool);
			}
		}
		this.registry.deregister(name);
	}

	/**
	 * Send a heartbeat for a package. Keeps the package "alive" in health checks.
	 */
	heartbeat(name: string, opts?: { status?: PackageStatus; error?: string }): void {
		this.registry.heartbeat(name, opts);
		this.collector.setHeartbeat(name, Date.now(), this.registry.get(name)?.status ?? "healthy");
	}

	/**
	 * Send a styled notification to the session TUI.
	 */
	notify(message: string, opts?: NotifyOptions): void {
		notify(this.pi, message, opts);
	}

	/**
	 * Record a tool invocation for a package.
	 */
	recordToolInvocation(pkgName: string, tool: string): void {
		this.collector.recordToolInvocation(pkgName, tool);
	}

	/**
	 * Record a tool result (duration, error status).
	 */
	recordToolResult(pkgName: string, tool: string, duration: number, isError: boolean): void {
		this.collector.recordToolResult(pkgName, tool, duration, isError);
	}

	/**
	 * Record token attribution for a package.
	 */
	recordTokens(pkgName: string, tokens: { input: number; output: number; cacheRead?: number; cacheWrite?: number }): void {
		this.collector.recordTokens(pkgName, tokens);
	}

	/**
	 * Record cost attribution for a package.
	 */
	recordCost(pkgName: string, cost: number): void {
		this.collector.recordCost(pkgName, cost);
	}

	/**
	 * Record an error for a package.
	 */
	recordError(pkgName: string, type: string, message: string, stack?: string): void {
		this.collector.recordError(pkgName, type, message, stack);
	}

	/**
	 * Get active package count.
	 */
	get packageCount(): number {
		return this.registry.list().length;
	}

	// ── Internal: Tool auto-tracking ──────────────────────────────────

	/**
	 * Auto-track every tool call. Maps the tool to its owning package
	 * (or "activity" fallback) and records the invocation + start time.
	 */
	private handleToolCall(event: { toolName?: string; toolCallId?: string; input?: Record<string, unknown> }): void {
		const toolName = event.toolName ?? "unknown";
		const toolCallId = event.toolCallId ?? `${toolName}-${Date.now()}`;

		// Record start time for duration calculation
		this.toolCallTimestamps.set(toolCallId, Date.now());

		// Track tool name for this turn's cost attribution
		this.turnToolNames.push(toolName);

		// Find owning package
		const pkgName = this.resolvePackage(toolName);

		// Record invocation
		this.collector.recordToolInvocation(pkgName, toolName);
	}

	/**
	 * Auto-track every tool result — record timing and errors.
	 */
	private handleToolResult(event: { toolName?: string; toolCallId?: string; isError?: boolean; content?: unknown }): void {
		const toolName = event.toolName ?? "unknown";
		const toolCallId = event.toolCallId ?? `${toolName}-${Date.now()}`;
		const isError = event.isError ?? false;

		// Compute duration
		const startTime = this.toolCallTimestamps.get(toolCallId);
		const duration = startTime ? Date.now() - startTime : 0;
		this.toolCallTimestamps.delete(toolCallId);

		// Find owning package
		const pkgName = this.resolvePackage(toolName);

		// Record result
		this.collector.recordToolResult(pkgName, toolName, duration, isError);

		// Auto-heartbeat the owning package
		if (this.registry.get(pkgName)) {
			this.heartbeat(pkgName);
		}
	}

	/**
	 * Attribute tokens/cost to all active packages for this turn.
	 * Uses per-turn tool tracking for weighted attribution.
	 */
	private handleMessageEnd(event: { message?: { role?: string; usage?: { tokens?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number }; cost?: { total?: number } } } }): void {
		if (event.message?.role !== "assistant") return;
		const usage = event.message.usage;
		if (!usage?.tokens) return;

		// Collect all unique packages that had tool calls this turn
		const turnPkgs = new Set<string>();
		for (const toolName of this.turnToolNames) {
			turnPkgs.add(this.resolvePackage(toolName));
		}

		// If no packages had tool calls, attribute to "activity"
		if (turnPkgs.size === 0) {
			turnPkgs.add(ACTIVITY_PACKAGE);
		}

		const share = 1 / turnPkgs.size;

		for (const pkgName of turnPkgs) {
			const tokens = {
				input: Math.round((usage.tokens?.input ?? 0) * share),
				output: Math.round((usage.tokens?.output ?? 0) * share),
				cacheRead: Math.round((usage.tokens?.cacheRead ?? 0) * share),
				cacheWrite: Math.round((usage.tokens?.cacheWrite ?? 0) * share),
			};
			this.collector.recordTokens(pkgName, tokens);

			if (usage.cost?.total) {
				this.collector.recordCost(pkgName, usage.cost.total * share);
			}
		}
	}

	/**
	 * Resolve a tool name to its owning package.
	 * Priority: registered package > built-in > fallback "activity".
	 */
	private resolvePackage(toolName: string): string {
		// Check if a registered package claims this tool
		const mapped = this.toolToPackage.get(toolName);
		if (mapped) return mapped;

		// Built-in tools belong to the "activity" package
		if (BUILTIN_TOOLS.has(toolName)) {
			return ACTIVITY_PACKAGE;
		}

		// Custom tools — check if any registered package exists
		const packages = this.registry.list();
		if (packages.length === 0) {
			return ACTIVITY_PACKAGE;
		}

		// If no package claims this tool, attribute to a generic "activity" bucket
		return ACTIVITY_PACKAGE;
	}
}

// ── Default Export ──────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	instance = new Telemetry(pi);
}
