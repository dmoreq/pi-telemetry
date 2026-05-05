/**
 * Telemetry Helpers — Tests
 *
 * getTelemetry() returns null in the test environment, so these verify
 * the helpers are safe no-ops when telemetry is not loaded.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	registerPackage,
	telemetryNotify,
	telemetryHeartbeat,
	recordEvent,
	recordMetric,
	recordError,
	recordToolUsage,
} from "./helpers.ts";

describe("telemetry-helpers (telemetry not loaded)", () => {
	it("registerPackage is a safe no-op", () => {
		assert.doesNotThrow(() => registerPackage({ name: "test", version: "1.0.0", description: "test" }));
	});

	it("telemetryNotify is a safe no-op", () => {
		assert.doesNotThrow(() => telemetryNotify("hello"));
	});

	it("telemetryHeartbeat is a safe no-op", () => {
		assert.doesNotThrow(() => telemetryHeartbeat("test"));
	});

	it("recordEvent is a safe no-op", () => {
		assert.doesNotThrow(() => recordEvent("test", "type", "label"));
	});

	it("recordMetric is a safe no-op", () => {
		assert.doesNotThrow(() => recordMetric("test", 42));
	});

	it("recordError is a safe no-op", () => {
		assert.doesNotThrow(() => recordError("test", "error", "msg"));
	});

	it("recordToolUsage is a safe no-op", () => {
		assert.doesNotThrow(() => recordToolUsage("test", "tool", 100, 50, false));
	});
});
