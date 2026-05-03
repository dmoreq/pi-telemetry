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
import type { Component } from "@mariozechner/pi-tui";
import type { BadgeVariant, NotifyOptions } from "./types.ts";
import { TELEMETRY_MSG_TYPE } from "./notify.ts";

// ── Badge variant → theme color mapping ────────────────────────────────

function badgeColor(theme: { fg: (color: string, text: string) => string }, variant: BadgeVariant): (text: string) => string {
	switch (variant) {
		case "info": return (t: string) => (theme.fg as (c: string, t: string) => string)("accent", t);
		case "success": return (t: string) => (theme.fg as (c: string, t: string) => string)("success", t);
		case "warning": return (t: string) => (theme.fg as (c: string, t: string) => string)("warning", t);
		case "danger": return (t: string) => (theme.fg as (c: string, t: string) => string)("error", t);
		case "primary": return (t: string) => (theme.fg as (c: string, t: string) => string)("toolTitle", t);
		case "secondary": return (t: string) => (theme.fg as (c: string, t: string) => string)("muted", t);
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

// ── Simple Text Component ────────────────────────────────────────────────

class TextComponent implements Component {
	private readonly lines: string[];

	constructor(text: string) {
		this.lines = text.split("\n");
	}

	get width(): number {
		return Math.max(...this.lines.map(l => l.length), 0);
	}

	get height(): number {
		return this.lines.length;
	}

	render(_width: number): string[] {
		return this.lines;
	}

	invalidate(): void {
		// no-op
	}
}

// ── Renderer registration ───────────────────────────────────────────────

export function registerTelemetryMessageRenderer(pi: ExtensionAPI): void {
	pi.registerMessageRenderer(TELEMETRY_MSG_TYPE, (message, options, theme) => {
		const themeAdapter = { fg: (c: string, t: string) => (theme.fg as (color: string, text: string) => string)(c, t) };
		const details = (message.details ?? {}) as NotifyOptions & {
			severity?: string;
			badge?: { text: string; variant: BadgeVariant };
			package?: string;
		};

		const severity = details.severity ?? "info";
		const emoji = severityEmoji(severity);
		const variant = details.badge?.variant ?? severityToVariant(severity);
		const badgeLabel = details.badge?.text ?? details.package ?? "telemetry";
		const color = badgeColor(themeAdapter, variant);

		// Build the badge: [package-name]
		const badge = (theme.fg as (c: string, t: string) => string)("muted", "[") + color(badgeLabel) + (theme.fg as (c: string, t: string) => string)("muted", "]");

		// Build the message line — convert content to string if needed
		const contentStr = typeof message.content === "string" ? message.content : "";
		const textColor = severity === "error" ? (t: string) => (theme.fg as (c: string, t: string) => string)("error", t)
			: severity === "warning" ? (t: string) => (theme.fg as (c: string, t: string) => string)("warning", t)
			: (t: string) => t;

		let text = `${badge} ${color(emoji)} ${textColor(contentStr)}`;

		// Expanded view shows details
		if (options.expanded && details.details) {
			const detailStr = JSON.stringify(details.details, null, 2);
			text += "\n" + (theme.fg as (c: string, t: string) => string)("muted", detailStr);
		}

		return new TextComponent(text);
	});
}

export { notify } from "./notify.ts";
