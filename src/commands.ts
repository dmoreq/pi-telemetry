/**
 * Telemetry Commands — /telemetry dashboard, /telemetry export, /health.
 *
 * /telemetry              — Interactive dashboard with per-package stats
 * /telemetry sort:<field> — Sorted dashboard (cost, invocations, errors, name)
 * /telemetry pkg:<name>   — Per-package drill-down with tool breakdown
 * /telemetry errors       — Recent errors grouped by package
 * /telemetry events       — Chronological domain event timeline
 * /telemetry metrics      — Aggregated metric summaries
 * /telemetry export       — Write JSON snapshot to file
 * /telemetry report       — Generate a summary (descriptive text)
 * /telemetry live         — Live-updating widget for 30s
 * /health                 — Quick per-package health overview
 * /health alert           — Show only packages in error/degraded state
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import type { PackageRegistry } from "./registry.ts";
import type { TelemetryCollector } from "./collector.ts";
import type { PackageTelemetry, DomainEvent, MetricSummary } from "./types.ts";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import {
	healthDot,
	formatCost,
	formatTokens,
	formatDuration,
	formatRow,
	padCol,
	formatTokenSparkline,
	costColor,
} from "./format.ts";

// ── Sub-command argument completions ────────────────────────────────────

type Ctx = Parameters<Parameters<ExtensionAPI["registerCommand"]>[1]["handler"]>[1];

const SUB_COMMANDS = ["sort:cost", "sort:invocations", "sort:errors", "sort:name", "pkg:", "errors", "events", "metrics", "export", "report", "live"];

// ── Notification severity type ───────────────────────────────────────────

type NotifySeverity = "error" | "info" | "success" | "warning";

// ── Theme-like interface (avoids ThemeColor dependency) ──────────────────

interface ThemeLike {
	fg: (color: string, text: string) => string;
	bold: (text: string) => string;
}

interface DashboardCtx {
	ui: {
		notify: (msg: string, severity: NotifySeverity) => void;
		theme: ThemeLike;
	};
}

interface FullCtx {
	cwd: string;
	ui: {
		notify: (msg: string, severity: NotifySeverity) => void;
		theme: ThemeLike;
		setWidget: (key: string, lines?: string[]) => void;
	};
}

// ── Sort types ──────────────────────────────────────────────────────────

type SortField = "name" | "cost" | "invocations" | "errors";

// ── Helpers ─────────────────────────────────────────────────────────────

function adaptCtx(ctx: ExtensionCommandContext): { cwd: string; notify: (msg: string, sev: NotifySeverity) => void; theme: ThemeLike; setWidget: (key: string, lines?: string[]) => void } {
	return {
		cwd: ctx.cwd,
		notify: (msg: string, sev: NotifySeverity) => (ctx.ui.notify as (m: string, s: string) => void)(msg, sev),
		theme: {
			fg: (color: string, text: string) => (ctx.ui.theme.fg as (c: string, t: string) => string)(color, text),
			bold: (text: string) => ctx.ui.theme.bold(text),
		},
		setWidget: (key, lines) => (ctx.ui.setWidget as (k: string, l?: string[]) => void)(key, lines),
	};
}

function showWidget(ctx: FullCtx, key: string, lines: string[], timeoutMs = 15_000): void {
	ctx.setWidget(key, lines);
	setTimeout(() => {
		try { ctx.setWidget(key, undefined); } catch { /* ignore */ }
	}, timeoutMs);
}

// ── Registration ────────────────────────────────────────────────────────

export function registerTelemetryCommands(
	pi: ExtensionAPI,
	registry: PackageRegistry,
	collector: TelemetryCollector,
): void {
	// ── /telemetry ────────────────────────────────────────────────────

	pi.registerCommand("telemetry", {
		description: "Show telemetry dashboard. Sub-commands: sort:<field>, pkg:<name>, errors, events, metrics, export, report, live",
		getArgumentCompletions: async (text: string) => {
			const prefix = text.trim().toLowerCase();
			if (prefix.startsWith("pkg:")) {
				const partial = prefix.slice(4);
				return registry.list()
					.filter(p => p.name.startsWith(partial))
					.map(p => ({ value: `pkg:${p.name}`, label: `pkg:${p.name}` }));
			}
			return SUB_COMMANDS
				.filter(v => v.startsWith(prefix))
				.map(v => ({ value: v, label: v }));
		},
		handler: async (args, ctx) => {
			const trimmed = args.trim().toLowerCase();
			const { notify, theme, setWidget, cwd } = adaptCtx(ctx);
			const fullCtx: FullCtx = { cwd, ui: { notify, theme, setWidget } };

			if (trimmed === "export") {
				await handleExport(collector, cwd, notify);
				return;
			}

			if (trimmed === "report") {
				await handleReport(registry, collector, notify);
				return;
			}

			if (trimmed === "errors") {
				showErrors(registry, collector, fullCtx);
				return;
			}

			if (trimmed === "events") {
				showEvents(collector, fullCtx);
				return;
			}

			if (trimmed === "metrics") {
				showMetrics(collector, fullCtx);
				return;
			}

			if (trimmed === "live") {
				showLiveDashboard(registry, collector, fullCtx, pi);
				return;
			}

			if (trimmed.startsWith("sort:")) {
				const field = trimmed.slice(5) as SortField;
				showDashboard(registry, collector, fullCtx, field);
				return;
			}

			if (trimmed.startsWith("pkg:")) {
				const pkgName = trimmed.slice(4);
				showPackageDetail(registry, collector, fullCtx, pkgName);
				return;
			}

			// Default: show dashboard
			showDashboard(registry, collector, fullCtx, "name");
		},
	});

	// ── /health ───────────────────────────────────────────────────────

	pi.registerCommand("health", {
		description: "Show per-package health status. Use 'health alert' for only unhealthy packages.",
		getArgumentCompletions: async (text: string) => {
			const prefix = text.trim().toLowerCase();
			return ["alert"]
				.filter(v => v.startsWith(prefix))
				.map(v => ({ value: v, label: v }));
		},
		handler: async (_args, ctx) => {
			const { theme, setWidget, notify } = adaptCtx(ctx);
			const trimmed = _args.trim().toLowerCase();
			showHealth(registry, { ui: { notify, theme, setWidget } }, trimmed === "alert");
		},
	});
}

// ── Dashboard ───────────────────────────────────────────────────────────

function showDashboard(
	registry: PackageRegistry,
	collector: TelemetryCollector,
	ctx: FullCtx,
	sortBy: SortField = "name",
): void {
	const packages = registry.list();
	const snapshot = collector.getSnapshot();
	const theme = ctx.ui.theme;

	if (packages.length === 0) {
		ctx.ui.notify("📊 No packages registered yet. Extensions register via telemetry.register().", "info");
		return;
	}

	// Sort
	const sorted = [...packages].sort((a, b) => {
		const ta = snapshot.packages[a.name];
		const tb = snapshot.packages[b.name];
		switch (sortBy) {
			case "cost": return (tb?.estimatedCost ?? 0) - (ta?.estimatedCost ?? 0);
			case "invocations": return (tb?.totalInvocations ?? 0) - (ta?.totalInvocations ?? 0);
			case "errors": return (tb?.totalErrors ?? 0) - (ta?.totalErrors ?? 0);
			default: return a.name.localeCompare(b.name);
		}
	});

	// Column widths
	const colWidths = {
		name: Math.max(7, ...sorted.map(p => p.name.length)),
		invs: 4,
		errors: 6,
		cost: 8,
		health: 2,
	};

	const lines: string[] = [];
	lines.push(theme.bold(`📊 Telemetry Dashboard (sorted by ${sortBy})`));
	lines.push("");

	const header = formatRow(
		padCol(theme.bold("Package"), colWidths.name),
		padCol(theme.bold("Invs"), colWidths.invs),
		padCol(theme.bold("Errors"), colWidths.errors),
		padCol(theme.bold("Cost"), colWidths.cost),
		theme.bold("H"),
	);
	lines.push(header);
	lines.push(theme.fg("dim", "─".repeat(header.length)));

	for (const pkg of sorted) {
		const tlm = snapshot.packages[pkg.name];
		const invs = String(tlm?.totalInvocations ?? 0);
		const errors = String(tlm?.totalErrors ?? 0);
		const cost = formatCost(tlm?.estimatedCost ?? 0);
		const costClr = costColor(tlm?.estimatedCost ?? 0);
		const costColored = costClr === "warning" ? theme.fg("warning", cost)
			: costClr === "error" ? theme.fg("error", cost)
			: cost;
		const dot = healthDot(theme, pkg.status);
		lines.push(formatRow(
			padCol(pkg.name, colWidths.name),
			padCol(invs, colWidths.invs),
			padCol(errors, colWidths.errors),
			padCol(costColored, colWidths.cost),
			dot,
		));
	}

	lines.push("");
	lines.push(theme.fg("dim",
		`Total: ${formatCost(snapshot.totalCost)} · ${snapshot.totalInvocations} invocations · ${snapshot.totalErrors} errors · ${formatTokens(snapshot.totalTokens)}`
	));

	showWidget(ctx, "pi-telemetry-dashboard", lines);
}

// ── Package Detail Drill-Down ───────────────────────────────────────────

function showPackageDetail(
	registry: PackageRegistry,
	collector: TelemetryCollector,
	ctx: FullCtx,
	pkgName: string,
): void {
	const pkg = registry.get(pkgName);
	if (!pkg) {
		ctx.ui.notify(`Package "${pkgName}" not found.`, "error");
		return;
	}

	const snapshot = collector.getSnapshot();
	const tlm = snapshot.packages[pkgName];
	if (!tlm) {
		ctx.ui.notify(`No telemetry data for "${pkgName}".`, "warning");
		return;
	}

	const theme = ctx.ui.theme;
	const lines: string[] = [];
	lines.push(theme.bold(`📦 ${pkgName}  v${tlm.version}`));
	lines.push(theme.fg("dim", pkg.description));
	lines.push("");

	const costClr = costColor(tlm.estimatedCost);
	const costStr = costClr === "warning" ? theme.fg("warning", formatCost(tlm.estimatedCost))
		: costClr === "error" ? theme.fg("error", formatCost(tlm.estimatedCost))
		: formatCost(tlm.estimatedCost);

	lines.push(`  Status:     ${healthDot(theme, tlm.status)} ${tlm.status}`);
	lines.push(`  Invocations: ${tlm.totalInvocations}`);
	lines.push(`  Errors:      ${tlm.totalErrors} (${(tlm.errorRate * 100).toFixed(1)}%)`);
	lines.push(`  Cost:        ${costStr}`);
	lines.push(`  Tokens:      ${formatTokenSparkline(tlm.inputTokens, tlm.outputTokens, tlm.cacheReadTokens, tlm.cacheWriteTokens)}`);
	lines.push(`  Duration:    ${formatDuration(tlm.totalExecutionMs)} total · avg ${formatDuration(tlm.avgExecutionMs)}`);
	lines.push(`  Heartbeat:   ${tlm.lastHeartbeat > 0 ? `${formatDuration(Date.now() - tlm.lastHeartbeat)} ago` : "never"}`);

	const toolNames = Object.keys(tlm.tools);
	if (toolNames.length > 0) {
		lines.push("");
		lines.push(theme.bold("  Tools:"));

		const tColWidths = {
			name: Math.max(4, ...toolNames.map(n => n.length)),
			invs: 4,
			errors: 6,
			avg: 11,
			p95: 11,
			max: 11,
		};

		lines.push(`    ${padCol("Tool", tColWidths.name)}  ${padCol("Invs", tColWidths.invs)}  ${padCol("Errors", tColWidths.errors)}  ${padCol("Avg", tColWidths.avg)}  ${padCol("P95", tColWidths.p95)}  ${padCol("Max", tColWidths.max)}`);
		lines.push(theme.fg("dim", `    ${"─".repeat(tColWidths.name + tColWidths.invs + tColWidths.errors + tColWidths.avg + tColWidths.p95 + tColWidths.max + 10)}`));

		for (const tool of toolNames) {
			const tt = tlm.tools[tool];
			lines.push(`    ${padCol(tool, tColWidths.name)}  ${padCol(String(tt.invocations), tColWidths.invs)}  ${padCol(String(tt.errors), tColWidths.errors)}  ${padCol(formatDuration(tt.avgDurationMs), tColWidths.avg)}  ${padCol(formatDuration(tt.p95DurationMs), tColWidths.p95)}  ${padCol(formatDuration(tt.maxDurationMs), tColWidths.max)}`);
		}
	}

	if (tlm.lastError) {
		lines.push("");
		lines.push(theme.bold("  Last Error:"));
		lines.push(theme.fg("error", `    ${tlm.lastError.type}: ${tlm.lastError.message}`));
		lines.push(theme.fg("dim", `    ${new Date(tlm.lastError.timestamp).toLocaleTimeString()} · count: ${tlm.lastError.count}`));
	}

	showWidget(ctx, "pi-telemetry-detail", lines, 20_000);
}

// ── Error View ──────────────────────────────────────────────────────────

function showErrors(
	registry: PackageRegistry,
	collector: TelemetryCollector,
	ctx: FullCtx,
): void {
	const snapshot = collector.getSnapshot();
	const theme = ctx.ui.theme;

	const errorPkgs = Object.entries(snapshot.packages)
		.filter(([_, tlm]) => tlm.totalErrors > 0);

	if (errorPkgs.length === 0) {
		ctx.ui.notify("✓ No errors recorded in this session.", "success");
		return;
	}

	const lines: string[] = [];
	lines.push(theme.bold("⚠ Telemetry Errors"));
	lines.push("");

	for (const [name, tlm] of errorPkgs) {
		lines.push(`  ${theme.fg("error", "●")} ${theme.bold(name)} — ${tlm.totalErrors} errors (${(tlm.errorRate * 100).toFixed(1)}%)`);
		if (tlm.lastError) {
			lines.push(`    ${theme.fg("error", "✗")} ${tlm.lastError.type}: ${tlm.lastError.message}`);
			lines.push(theme.fg("dim", `    ${new Date(tlm.lastError.timestamp).toLocaleTimeString()} · count: ${tlm.lastError.count}`));
		}
		lines.push("");
	}

	lines.push(theme.fg("dim", `Total: ${snapshot.totalErrors} errors across ${errorPkgs.length} packages`));

	showWidget(ctx, "pi-telemetry-errors", lines);
}

// ── Event Timeline ──────────────────────────────────────────────────────

function showEvents(
	collector: TelemetryCollector,
	ctx: FullCtx,
): void {
	const events = collector.getEvents();
	const theme = ctx.ui.theme;

	if (events.length === 0) {
		ctx.ui.notify("No domain events recorded in this session. Extensions use t.recordEvent() to emit events.", "info");
		return;
	}

	const lines: string[] = [];
	lines.push(theme.bold("📊 Event Timeline"));
	lines.push("");

	const display = events.slice(-50).reverse();
	for (const evt of display) {
		const time = new Date(evt.timestamp).toLocaleTimeString();
		const pkg = theme.fg("accent", evt.package);
		const type = theme.fg("dim", evt.type);
		let line = `  ${theme.fg("dim", time)}  ${pkg}  ${type}  ${evt.label}`;

		const files = evt.data?.files as string[] | undefined;
		if (files && files.length > 0) {
			const short = files.map(f => f.split("/").slice(-2).join("/")).join(", ");
			line += theme.fg("dim", ` (${short})`);
		}

		const tokens = evt.data?.tokens as number | undefined;
		if (tokens !== undefined) {
			line += theme.fg("dim", ` ~${tokens}t`);
		}

		lines.push(line);
	}

	lines.push("");
	lines.push(theme.fg("dim", `${events.length} total events · showing last ${Math.min(50, events.length)}`));

	showWidget(ctx, "pi-telemetry-events", lines);
}

// ── Metrics Dashboard ───────────────────────────────────────────────────

function showMetrics(
	collector: TelemetryCollector,
	ctx: FullCtx,
): void {
	const summaries = collector.getMetricSummaries();
	const theme = ctx.ui.theme;

	if (summaries.length === 0) {
		ctx.ui.notify("No metrics recorded in this session. Extensions use t.recordMetric() to emit metrics.", "info");
		return;
	}

	const lines: string[] = [];
	lines.push(theme.bold("📊 Telemetry Metrics"));
	lines.push("");

	const colWidths = {
		name: Math.max(6, ...summaries.map(s => s.name.length)),
		value: 12,
		avg: 12,
		count: 5,
	};

	const header = formatRow(
		padCol(theme.bold("Metric"), colWidths.name),
		padCol(theme.bold("Value"), colWidths.value),
		padCol(theme.bold("Avg"), colWidths.avg),
		padCol(theme.bold("Count"), colWidths.count),
	);
	lines.push(header);
	lines.push(theme.fg("dim", "─".repeat(header.length)));

	for (const m of summaries) {
		const val = m.cumulative ? String(Math.round(m.total)) : formatMetricValue(m.lastValue);
		const avg = formatMetricValue(m.average);
		const count = String(m.count);
		lines.push(formatRow(
			padCol(m.name, colWidths.name),
			padCol(theme.fg("accent", val), colWidths.value),
			padCol(avg, colWidths.avg),
			padCol(count, colWidths.count),
		));
	}

	lines.push("");
	lines.push(theme.fg("dim", `${summaries.length} metrics`));

	showWidget(ctx, "pi-telemetry-metrics", lines);
}

function formatMetricValue(value: number): string {
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
	if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
	if (value % 1 === 0) return String(value);
	return value.toFixed(2);
}

// ── Live Dashboard ──────────────────────────────────────────────────────

let liveDashboardTimer: ReturnType<typeof setTimeout> | null = null;

function showLiveDashboard(
	registry: PackageRegistry,
	collector: TelemetryCollector,
	ctx: FullCtx,
	pi: ExtensionAPI,
): void {
	if (liveDashboardTimer) {
		clearTimeout(liveDashboardTimer);
		liveDashboardTimer = null;
	}

	let ticks = 0;
	const MAX_TICKS = 30;

	function renderLive() {
		const snapshot = collector.getSnapshot();
		const theme = ctx.ui.theme;
		const packages = registry.list();

		const lines: string[] = [];
		lines.push(theme.bold("📊 Live Telemetry"));

		for (const pkg of packages) {
			const tlm = snapshot.packages[pkg.name];
			if (!tlm || tlm.totalInvocations === 0) continue;

			const invs = String(tlm.totalInvocations);
			const cost = formatCost(tlm.estimatedCost);
			const dot = healthDot(theme, pkg.status);
			lines.push(`  ${dot} ${pkg.name} · ${invs} calls · ${cost}`);
		}

		lines.push("");
		lines.push(theme.fg("dim", `Total: ${formatCost(snapshot.totalCost)} · ${snapshot.totalInvocations} calls · auto-refresh ${MAX_TICKS - ticks}s`));
		lines.push(theme.fg("dim", "Run /telemetry to end live mode."));

		try { ctx.setWidget("pi-telemetry-live", lines); } catch { /* ignore */ }

		ticks++;
		if (ticks < MAX_TICKS) {
			liveDashboardTimer = setTimeout(renderLive, 1_000);
		} else {
			try { ctx.setWidget("pi-telemetry-live", undefined); } catch { /* ignore */ }
			liveDashboardTimer = null;
		}
	}

	renderLive();

	setTimeout(() => {
		try { ctx.setWidget("pi-telemetry-live", undefined); } catch { /* ignore */ }
		liveDashboardTimer = null;
	}, MAX_TICKS * 1_000);
}

// ── Export ──────────────────────────────────────────────────────────────

async function handleExport(
	collector: TelemetryCollector,
	cwd: string,
	notify: (msg: string, sev: NotifySeverity) => void,
): Promise<void> {
	const snapshot = collector.getSnapshot();
	const exportDir = join(cwd, ".pi", "telemetry");
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
	const exportPath = join(exportDir, `export-${timestamp}.json`);

	try {
		if (!existsSync(exportDir)) {
			await mkdir(exportDir, { recursive: true });
		}
		await writeFile(exportPath, JSON.stringify(snapshot, null, 2), "utf-8");
		notify(`Telemetry exported to ${exportPath}`, "success");
	} catch (error) {
		const msg = error instanceof Error ? error.message : "Unknown error";
		notify(`Failed to export telemetry: ${msg}`, "error");
	}
}

// ── Report ──────────────────────────────────────────────────────────────

async function handleReport(
	registry: PackageRegistry,
	collector: TelemetryCollector,
	notify: (msg: string, sev: NotifySeverity) => void,
): Promise<void> {
	const snapshot = collector.getSnapshot();
	const packages = registry.list();

	if (packages.length === 0) {
		notify("No telemetry data to report.", "info");
		return;
	}

	const lines: string[] = [];
	lines.push(`Session Telemetry Report (${new Date(snapshot.sessionStart).toLocaleString()}):`);
	lines.push("");

	for (const pkg of packages) {
		const tlm = snapshot.packages[pkg.name];
		if (!tlm || tlm.totalInvocations === 0) {
			lines.push(`  • ${pkg.name}: no activity`);
			continue;
		}

		const parts: string[] = [`${pkg.name}:`];
		parts.push(`${tlm.totalInvocations} invocations`);

		if (tlm.totalErrors > 0) {
			parts.push(`${tlm.totalErrors} errors (${(tlm.errorRate * 100).toFixed(1)}% error rate)`);
		} else {
			parts.push(`0 errors`);
		}

		if (tlm.estimatedCost > 0) {
			parts.push(`${formatCost(tlm.estimatedCost)} estimated cost`);
		}

		if (tlm.totalTokens > 0) {
			parts.push(`${formatTokens(tlm.totalTokens)} tokens`);
		}

		if (tlm.totalExecutionMs > 0) {
			parts.push(`${formatDuration(tlm.totalExecutionMs)} total execution time`);
		}

		lines.push(`  • ${parts.join(", ")}`);
	}

	lines.push("");
	lines.push(`Totals: ${formatCost(snapshot.totalCost)} · ${snapshot.totalInvocations} invocations · ${snapshot.totalErrors} errors`);

	notify(lines.join("\n"), "info");
}

// ── Health ──────────────────────────────────────────────────────────────

function showHealth(
	registry: PackageRegistry,
	ctx: FullCtx,
	alertOnly: boolean,
): void {
	const packages = registry.list();
	if (packages.length === 0) {
		ctx.ui.notify("No packages registered. Extensions need to call telemetry.register() to appear here.", "info");
		return;
	}

	const health = registry.health();
	const theme = ctx.ui.theme;
	const lines: string[] = [];

	if (alertOnly) {
		const unhealthy = packages.filter(p => p.status === "error" || p.status === "degraded");
		if (unhealthy.length === 0) {
			ctx.ui.notify("✓ All packages healthy.", "success");
			return;
		}
		lines.push(theme.bold(`⚠ Health Alerts (${unhealthy.length} unhealthy)`));
		lines.push("");
		for (const pkg of unhealthy) {
			const elapsed = Date.now() - pkg.lastHeartbeat;
			const ago = formatDuration(elapsed);
			const dot = healthDot(theme, pkg.status);
			const name = theme.bold(pkg.name);
			const version = theme.fg("dim", `v${pkg.version}`);
			lines.push(`  ${dot}  ${name} ${version} — ${pkg.status} · ${ago} ago`);
			if (pkg.lastError) {
				lines.push(`       ${theme.fg("error", `✗ ${pkg.lastError.message}`)}`);
			}
		}
	} else {
		lines.push(`Health Check (${health.total} packages):`);
		lines.push("");

		for (const pkg of packages) {
			const elapsed = Date.now() - pkg.lastHeartbeat;
			const ago = formatDuration(elapsed);
			const dot = healthDot(theme, pkg.status);
			const name = theme.bold(pkg.name);
			const version = theme.fg("dim", `v${pkg.version}`);
			const lastSeen = pkg.status === "stale" ? theme.fg("dim", "stale") : `${ago} ago`;

			lines.push(`  ${dot}  ${name} ${version} — ${lastSeen}`);

			if (pkg.lastError && pkg.status === "error") {
				lines.push(`       ${theme.fg("error", `✗ ${pkg.lastError.message}`)}`);
			}
		}

		lines.push("");
		lines.push(theme.fg("success", `◉ ${health.healthy} healthy`));
		if (health.degraded > 0) lines.push(theme.fg("warning", `◉ ${health.degraded} degraded`));
		if (health.error > 0) lines.push(theme.fg("error", `◉ ${health.error} error`));
		if (health.stale > 0) lines.push(theme.fg("dim", `○ ${health.stale} stale`));
	}

	showWidget(ctx, "pi-health", lines, 10_000);
}
