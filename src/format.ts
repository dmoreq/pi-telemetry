/**
 * format.ts — Shared formatting helpers for the telemetry UI layer.
 *
 * Consolidates theme-based health dots, cost/token/duration formatting
 * and row layout so that commands.ts and widget.ts share a single source.
 */

/** Minimal theme interface used by the helpers. */
export interface ThemeLike {
	fg: (color: string, text: string) => string;
	bold?: (text: string) => string;
}

/**
 * Return a coloured health-status dot for a given status.
 *
 *   ◉ healthy (green)  ◉ degraded (yellow)  ◉ error (red)  ○ stale (dim)
 */
export function healthDot(theme: ThemeLike, status: string): string {
	switch (status) {
		case "healthy":
			return theme.fg("success", "◉");
		case "degraded":
			return theme.fg("warning", "◉");
		case "error":
			return theme.fg("error", "◉");
		default:
			return theme.fg("dim", "○");
	}
}

/**
 * Format a USD cost value, e.g. 0 → "$0.00", 0.005 → "< $0.01", 1.5 → "$1.50".
 */
export function formatCost(cost: number): string {
	if (cost === 0) return "$0.00";
	if (cost < 0.01) return "< $0.01";
	return `$${cost.toFixed(2)}`;
}

/**
 * Format a token count, e.g. 500 → "500 tokens", 1500 → "1.5K tokens".
 */
export function formatTokens(tokens: number): string {
	if (tokens < 1000) return `${tokens} tokens`;
	if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(1)}K tokens`;
	return `${(tokens / 1_000_000).toFixed(1)}M tokens`;
}

/**
 * Format a duration in milliseconds to a human-readable string.
 *   500 → "500ms", 2500 → "2.5s", 125000 → "2m 5s"
 */
export function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
	return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

/**
 * Join columns with double-space delimiter for aligned output.
 */
export function formatRow(...cols: string[]): string {
	return cols.join("  ");
}
