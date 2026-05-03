/**
 * Telemetry Commands — /telemetry dashboard, /telemetry export, /health.
 *
 * /telemetry        — Interactive dashboard with per-package stats
 * /telemetry export — Write JSON snapshot to file
 * /telemetry report — Generate a summary (descriptive text)
 * /health           — Quick per-package health overview
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { PackageRegistry } from "./registry.ts";
import type { TelemetryCollector } from "./collector.ts";
import type { RegisteredPackage, PackageTelemetry, SessionTelemetry } from "./types.ts";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";

// ── Registration ────────────────────────────────────────────────────────

export function registerTelemetryCommands(
	pi: ExtensionAPI,
	registry: PackageRegistry,
	collector: TelemetryCollector,
): void {
	// ── /telemetry ────────────────────────────────────────────────────

	pi.registerCommand("telemetry", {
		description: "Show telemetry dashboard or export report. Usage: /telemetry [export|report]",
		getArgumentCompletions: async (text: string) => {
			const prefix = text.trim().toLowerCase();
			return ["export", "report"]
				.filter(v => v.startsWith(prefix))
				.map(v => ({ value: v, label: v }));
		},
		handler: async (args, ctx) => {
			const trimmed = args.trim().toLowerCase();

			if (trimmed === "export") {
				await handleExport(collector, ctx);
				return;
			}

			if (trimmed === "report") {
				await handleReport(registry, collector, ctx);
				return;
			}

			// Default: show dashboard as widget
			showDashboard(registry, collector, ctx);
		},
	});

	// ── /health ───────────────────────────────────────────────────────

	pi.registerCommand("health", {
		description: "Show per-package health status",
		handler: async (_args, ctx) => {
			const packages = registry.list();
			if (packages.length === 0) {
				ctx.ui.notify("No packages registered. Extensions need to call telemetry.register() to appear here.", "info");
				return;
			}

			const health = registry.health();
			const theme = ctx.ui.theme;
			const lines: string[] = [];
			lines.push(`Health Check (${health.total} packages):`);
			lines.push("");

			for (const pkg of packages) {
				const elapsed = Date.now() - pkg.lastHeartbeat;
				const ago = formatDuration(elapsed);
				const dot = getHealthDot(theme, pkg.status);
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

			ctx.ui.setWidget("pi-health", lines);
			setTimeout(() => ctx.ui.setWidget("pi-health", undefined), 10_000);
		},
	});
}

// ── Dashboard ───────────────────────────────────────────────────────────

function showDashboard(
	registry: PackageRegistry,
	collector: TelemetryCollector,
	ctx: { ui: { notify: (msg: string, severity: string) => void; theme: { fg: (c: string, t: string) => string; bold: (t: string) => string } } },
): void {
	const packages = registry.list();
	const snapshot = collector.getSnapshot();
	const theme = ctx.ui.theme;

	if (packages.length === 0) {
		ctx.ui.notify("📊 No packages registered yet. Extensions register via telemetry.register().", "info");
		return;
	}

	const lines: string[] = [];
	lines.push(theme.bold("📊 Telemetry Dashboard"));
	lines.push("");

	// Header
	const header = formatRow(
		theme.bold("Package"),
		theme.bold("Invs"),
		theme.bold("Errors"),
		theme.bold("Cost"),
		theme.bold("Health"),
	);
	lines.push(header);
	lines.push(theme.fg("dim", "─".repeat(header.length)));

	// Package rows
	for (const pkg of packages) {
		const tlm = snapshot.packages[pkg.name];
		const invs = String(tlm?.totalInvocations ?? 0);
		const errors = String(tlm?.totalErrors ?? 0);
		const cost = formatCost(tlm?.estimatedCost ?? 0);
		const dot = getHealthDot(theme, pkg.status);
		lines.push(formatRow(pkg.name, invs, errors, cost, dot));
	}

	// Totals
	lines.push("");
	lines.push(theme.fg("dim", `Total: ${formatCost(snapshot.totalCost)} | ${snapshot.totalInvocations} invocations | ${snapshot.totalErrors} errors`));

	ctx.ui.notify(lines.join("\n"), "info");
}

// ── Export ──────────────────────────────────────────────────────────────

async function handleExport(
	collector: TelemetryCollector,
	ctx: { cwd: string; ui: { notify: (msg: string, severity: string) => void } },
): Promise<void> {
	const snapshot = collector.getSnapshot();
	const exportDir = join(ctx.cwd, ".pi", "telemetry");
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
	const exportPath = join(exportDir, `export-${timestamp}.json`);

	try {
		if (!existsSync(exportDir)) {
			await mkdir(exportDir, { recursive: true });
		}
		await writeFile(exportPath, JSON.stringify(snapshot, null, 2), "utf-8");
		ctx.ui.notify(`Telemetry exported to ${exportPath}`, "success");
	} catch (error) {
		const msg = error instanceof Error ? error.message : "Unknown error";
		ctx.ui.notify(`Failed to export telemetry: ${msg}`, "error");
	}
}

// ── Report ──────────────────────────────────────────────────────────────

async function handleReport(
	registry: PackageRegistry,
	collector: TelemetryCollector,
	ctx: { ui: { notify: (msg: string, severity: string) => void } },
): Promise<void> {
	const snapshot = collector.getSnapshot();
	const packages = registry.list();

	if (packages.length === 0) {
		ctx.ui.notify("No telemetry data to report.", "info");
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
	lines.push(`Totals: ${formatCost(snapshot.totalCost)} | ${snapshot.totalInvocations} invocations | ${snapshot.totalErrors} errors`);

	ctx.ui.notify(lines.join("\n"), "info");
}

// ── Helpers ─────────────────────────────────────────────────────────────

function formatCost(cost: number): string {
	if (cost === 0) return "$0.00";
	if (cost < 0.01) return `< $0.01`;
	return `$${cost.toFixed(2)}`;
}

function formatTokens(tokens: number): string {
	if (tokens < 1000) return `${tokens} tokens`;
	if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(1)}K tokens`;
	return `${(tokens / 1_000_000).toFixed(1)}M tokens`;
}

function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
	return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

function formatRow(...cols: string[]): string {
	return cols.join("  ");
}

function getHealthDot(
	theme: { fg: (color: string, text: string) => string },
	status: string,
): string {
	switch (status) {
		case "healthy": return theme.fg("success", "◉");
		case "degraded": return theme.fg("warning", "◉");
		case "error": return theme.fg("error", "◉");
		default: return theme.fg("dim", "○");
	}
}
