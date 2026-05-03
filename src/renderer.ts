/**
 * Telemetry Message Renderer — badge-style notifications in the session TUI.
 *
 * Registers a custom message renderer for "pi-telemetry.notify" messages.
 * Notifications appear as:
 *   [package-name] ✓ Message text
 *
 * Badge variants map to theme colors:
 *   info    → accent
 *   success → success (green)
 *   warning → warning (yellow)
 *   danger  → error (red)
 *   primary → bold accent
 *   secondary → muted
 *   light   → default (no color)
 */

import type { ExtensionAPI, Theme } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import type { BadgeVariant, NotifyOptions } from "./types.ts";
import { TELEMETRY_MSG_TYPE } from "./notify.ts";

// ── Badge variant → theme color mapping ────────────────────────────────

function badgeColor(theme: Theme, variant: BadgeVariant): (text: string) => string {
	switch (variant) {
		case "info": return (t: string) => theme.fg("accent", t);
		case "success": return (t: string) => theme.fg("success", t);
		case "warning": return (t: string) => theme.fg("warning", t);
		case "danger": return (t: string) => theme.fg("error", t);
		case "primary": return (t: string) => theme.fg("toolTitle", t);
		case "secondary": return (t: string) => theme.fg("muted", t);
		case "light": return (t: string) => t;
	}
}

function severityToVariant(severity: string): BadgeVariant {
	switch (severity) {
		case "success": return "success";
		case "warning": return "warning";
		case "error": return "danger";
		default: return "info";
	}
}

// ── Severity → emoji prefix ─────────────────────────────────────────────

function severityEmoji(severity: string): string {
	switch (severity) {
		case "success": return "✓";
		case "warning": return "⚠";
		case "error": return "✗";
		default: return "●";
	}
}

// ── Renderer registration ───────────────────────────────────────────────

export function registerTelemetryMessageRenderer(pi: ExtensionAPI): void {
	pi.registerMessageRenderer(TELEMETRY_MSG_TYPE, (message, options, theme) => {
		const details = (message.details ?? {}) as NotifyOptions & {
			severity?: string;
			badge?: { text: string; variant: BadgeVariant };
			package?: string;
		};

		const severity = details.severity ?? "info";
		const emoji = severityEmoji(severity);
		const variant = details.badge?.variant ?? severityToVariant(severity);
		const badgeLabel = details.badge?.text ?? details.package ?? "telemetry";
		const color = badgeColor(theme, variant);

		// Build the badge: [package-name]
		const badge = theme.fg("muted", "[") + color(badgeLabel) + theme.fg("muted", "]");

		// Build the message line
		const textColor = severity === "error" ? (t: string) => theme.fg("error", t)
			: severity === "warning" ? (t: string) => theme.fg("warning", t)
			: (t: string) => t;

		let text = `${badge} ${color(emoji)} ${textColor(message.content)}`;

		// Expanded view shows details
		if (options.expanded && details.details) {
			const detailStr = JSON.stringify(details.details, null, 2);
			text += "\n" + theme.fg("dim", detailStr);
		}

		return new Text(text, 0, 0);
	});
}

export { notify } from "./notify.ts";
