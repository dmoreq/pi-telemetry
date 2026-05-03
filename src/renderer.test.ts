/**
 * Telemetry Message Renderer — Tests
 *
 * Tests the notify() helper. The renderer registration uses pi's TUI
 * which can only be tested inside the pi process, so we test the
 * data flow (message shape) here.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { notify } from "./notify.ts";

// Minimal pi.sendMessage mock
function createMockPi(): { pi: { sendMessage: (msg: unknown) => void }; lastMessage: () => Record<string, unknown> | null } {
	let message: Record<string, unknown> | null = null;
	return {
		pi: {
			sendMessage: (msg: unknown) => {
				message = msg as Record<string, unknown>;
			},
		} as unknown as import("@mariozechner/pi-coding-agent").ExtensionAPI,
		lastMessage: () => message,
	};
}

describe("Telemetry Renderer", () => {
	describe("notify", () => {
		it("sends a custom message via pi.sendMessage", () => {
			const { pi, lastMessage } = createMockPi();

			notify(pi, "Package loaded", {
				package: "test-pkg",
				severity: "success",
			});

			const msg = lastMessage();
			assert(msg);
			assert.equal(msg.customType, "pi-telemetry.notify");
			assert.equal(msg.content, "Package loaded");
			assert.equal(msg.display, true);
		});

		it("includes badge options in details", () => {
			const { pi, lastMessage } = createMockPi();

			notify(pi, "Edit blocked", {
				package: "read-guard",
				severity: "warning",
				badge: { text: "BLOCKED", variant: "warning" },
				details: { reason: "no prior read" },
			});

			const msg = lastMessage();
			assert(msg);
			const details = msg.details as Record<string, unknown>;
			assert(details);
			assert.equal(details.package, "read-guard");
			assert.equal(details.severity, "warning");
			assert(details.badge);
		});

		it("handles missing package gracefully", () => {
			const { pi, lastMessage } = createMockPi();

			notify(pi, "Generic notification");

			const msg = lastMessage();
			assert.equal(msg?.content, "Generic notification");
			assert.equal(msg?.display, true);
		});

		it("handles error severity", () => {
			const { pi, lastMessage } = createMockPi();

			notify(pi, "Something broke", {
				package: "test-pkg",
				severity: "error",
			});

			const msg = lastMessage();
			const details = msg?.details as Record<string, unknown>;
			assert.equal(details.severity, "error");
		});
	});
});
