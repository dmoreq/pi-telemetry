/**
 * Telemetry Notify Helper — sends badge-style notifications via pi.sendMessage.
 *
 * This module intentionally has NO imports from @mariozechner/pi-tui
 * or @mariozechner/pi-coding-agent (except type-only) so it can be
 * imported in test contexts without needing those peer dependencies.
 *
 * The renderer registration (with TUI) lives in renderer.ts.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { NotifyOptions } from "./types.ts";

export const TELEMETRY_MSG_TYPE = "pi-telemetry.notify";

/**
 * Send a telemetry notification via pi.sendMessage.
 * This renders as a badge-style line in the session TUI.
 */
export function notify(
	pi: ExtensionAPI,
	message: string,
	opts?: NotifyOptions,
): void {
	pi.sendMessage({
		customType: TELEMETRY_MSG_TYPE,
		content: message,
		display: true,
		details: opts as Record<string, unknown>,
	});
}
