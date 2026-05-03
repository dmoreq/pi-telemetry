/**
 * Telemetry Status Widget — health dots in the session status bar.
 *
 * Shows a compact one-line widget:
 *   📊 Telemetry: ◉ read-guard  ◉ plan-mode  ○ ralph-loop  ...
 *
 * Dot colors:
 *   ◉ healthy   → green
 *   ◉ degraded  → yellow
 *   ◉ error     → red
 *   ○ stale     → dim/gray
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { PackageRegistry } from "./registry.ts";

const WIDGET_KEY = "pi-telemetry";
const WIDGET_REFRESH_MS = 30_000; // Throttle refresh to every 30s
const MAX_WIDGET_PKGS = 10; // Show max 10 packages in widget

let lastWidgetRefresh = 0;

export function registerTelemetryWidget(
	pi: ExtensionAPI,
	registry: PackageRegistry,
): void {
	function updateWidget(ctx: ExtensionContext) {
		const now = Date.now();
		if (now - lastWidgetRefresh < WIDGET_REFRESH_MS && lastWidgetRefresh > 0) return;
		lastWidgetRefresh = now;

		const packages = registry.list();
		if (packages.length === 0) {
			ctx.ui.setWidget(WIDGET_KEY, undefined);
			return;
		}

		const theme = ctx.ui.theme;
		const fg = (color: string, text: string) => (theme.fg as (c: string, t: string) => string)(color, text);
		const parts: string[] = ["📊"];

		const display = packages.slice(0, MAX_WIDGET_PKGS);
		for (const pkg of display) {
			const dot = getDot(fg, pkg.status);
			parts.push(`${dot} ${pkg.name}`);
		}

		if (packages.length > MAX_WIDGET_PKGS) {
			parts.push(fg("dim", `+${packages.length - MAX_WIDGET_PKGS}`));
		}

		ctx.ui.setWidget(WIDGET_KEY, [parts.join("  ")]);
	}

	// Initial render
	pi.on("session_start", (_event, ctx) => {
		updateWidget(ctx);
	});

	// Refresh widget on tool calls (throttled)
	pi.on("tool_call", (_event, ctx) => {
		updateWidget(ctx);
	});
}

function getDot(fg: (color: string, text: string) => string, status: string): string {
	switch (status) {
		case "healthy": return fg("success", "◉");
		case "degraded": return fg("warning", "◉");
		case "error": return fg("error", "◉");
		case "stale": return fg("dim", "○");
		default: return fg("dim", "○");
	}
}
