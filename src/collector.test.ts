/**
 * TelemetryCollector — Tests
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TelemetryCollector } from "./collector.ts";

describe("TelemetryCollector", () => {
	describe("recordToolInvocation", () => {
		it("increments totalInvocations", () => {
			const c = new TelemetryCollector();
			c.recordToolInvocation("test-pkg", "read");
			c.recordToolInvocation("test-pkg", "read");
			c.recordToolInvocation("test-pkg", "edit");

			const snapshot = c.getSnapshot();
			assert.equal(snapshot.packages["test-pkg"]!.totalInvocations, 3);
			assert.equal(snapshot.packages["test-pkg"]!.tools["read"]!.invocations, 2);
			assert.equal(snapshot.packages["test-pkg"]!.tools["edit"]!.invocations, 1);
		});

		it("creates package entry on first invocation", () => {
			const c = new TelemetryCollector();
			c.recordToolInvocation("new-pkg", "bash");

			const snapshot = c.getSnapshot();
			assert(snapshot.packages["new-pkg"]);
			assert.equal(snapshot.packages["new-pkg"]!.totalInvocations, 1);
		});
	});

	describe("recordToolResult", () => {
		it("tracks timing and computes avg", () => {
			const c = new TelemetryCollector();
			c.recordToolInvocation("test-pkg", "read");
			c.recordToolResult("test-pkg", "read", 100, false);
			c.recordToolInvocation("test-pkg", "read");
			c.recordToolResult("test-pkg", "read", 200, false);

			const tlm = c.getSnapshot().packages["test-pkg"]!.tools["read"]!;
			assert.equal(tlm.invocations, 2);
			assert.equal(tlm.avgDurationMs, 150); // (100 + 200) / 2
			assert.equal(tlm.maxDurationMs, 200);
		});

		it("increments errors on error results", () => {
			const c = new TelemetryCollector();
			c.recordToolInvocation("test-pkg", "read");
			c.recordToolResult("test-pkg", "read", 50, true);

			const pkg = c.getSnapshot().packages["test-pkg"]!;
			assert.equal(pkg.totalErrors, 1);
			assert.equal(pkg.tools["read"]!.errors, 1);
		});

		it("does not increment errors on non-error results", () => {
			const c = new TelemetryCollector();
			c.recordToolInvocation("test-pkg", "read");
			c.recordToolResult("test-pkg", "read", 50, false);

			assert.equal(c.getSnapshot().packages["test-pkg"]!.totalErrors, 0);
		});
	});

	describe("p95 calculation", () => {
		it("correctly computes p95 with 100+ entries", () => {
			const c = new TelemetryCollector();
			c.recordToolInvocation("test-pkg", "read");

			// Add 100 durations: 0–99ms
			for (let i = 0; i < 100; i++) {
				c.recordToolResult("test-pkg", "read", i, false);
				if (i < 99) c.recordToolInvocation("test-pkg", "read");
			}

			const tool = c.getSnapshot().packages["test-pkg"]!.tools["read"]!;
			// p95 of 0..99 should be around 94 (index = ceil(100*0.95)-1 = 94)
			assert(tool.p95DurationMs >= 90 && tool.p95DurationMs <= 99);
		});

		it("handles empty execution array", () => {
			const c = new TelemetryCollector();
			c.recordToolInvocation("test-pkg", "read");
			// No results recorded yet
			const tool = c.getSnapshot().packages["test-pkg"]!.tools["read"]!;
			assert.equal(tool.p95DurationMs, 0);
		});
	});

	describe("recordTokens", () => {
		it("accumulates input and output tokens", () => {
			const c = new TelemetryCollector();
			c.recordTokens("test-pkg", { input: 100, output: 50 });
			c.recordTokens("test-pkg", { input: 200, output: 150 });

			const pkg = c.getSnapshot().packages["test-pkg"]!;
			assert.equal(pkg.inputTokens, 300);
			assert.equal(pkg.outputTokens, 200);
			assert.equal(pkg.totalTokens, 500);
		});

		it("includes cache tokens", () => {
			const c = new TelemetryCollector();
			c.recordTokens("test-pkg", { input: 100, output: 50, cacheRead: 30, cacheWrite: 20 });

			const pkg = c.getSnapshot().packages["test-pkg"]!;
			assert.equal(pkg.cacheReadTokens, 30);
			assert.equal(pkg.cacheWriteTokens, 20);
			assert.equal(pkg.totalTokens, 200);
		});
	});

	describe("recordCost", () => {
		it("accumulates cost", () => {
			const c = new TelemetryCollector();
			c.recordCost("test-pkg", 0.01);
			c.recordCost("test-pkg", 0.02);

			assert.equal(c.getSnapshot().packages["test-pkg"]!.estimatedCost, 0.03);
		});
	});

	describe("recordError", () => {
		it("sets lastError and increments totalErrors", () => {
			const c = new TelemetryCollector();
			c.recordError("test-pkg", "timeout", "Request timed out");

			const pkg = c.getSnapshot().packages["test-pkg"]!;
			assert.equal(pkg.totalErrors, 1);
			assert(pkg.lastError);
			assert.equal(pkg.lastError!.type, "timeout");
			assert.equal(pkg.lastError!.message, "Request timed out");
			assert.equal(pkg.lastError!.count, 1);
		});

		it("increments error count on repeated calls", () => {
			const c = new TelemetryCollector();
			c.recordError("test-pkg", "timeout", "Error 1");
			c.recordError("test-pkg", "crash", "Error 2");

			assert.equal(c.getSnapshot().packages["test-pkg"]!.totalErrors, 2);
			assert.equal(c.getSnapshot().packages["test-pkg"]!.lastError!.count, 2);
		});
	});

	describe("getSnapshot / fromSnapshot", () => {
		it("getSnapshot returns full state", () => {
			const c = new TelemetryCollector();
			c.recordToolInvocation("pkg-a", "bash");
			c.recordToolResult("pkg-a", "bash", 100, false);
			c.recordTokens("pkg-a", { input: 500, output: 300 });
			c.recordCost("pkg-a", 0.005);

			const snapshot = c.getSnapshot();
			assert(snapshot.sessionStart > 0);
			assert(snapshot.packages["pkg-a"]);
			assert.equal(snapshot.totalInvocations, 1);
			assert.equal(snapshot.totalTokens, 800);
			assert.equal(snapshot.totalCost, 0.005);
		});

		it("fromSnapshot restores state correctly", () => {
			const c = new TelemetryCollector();
			c.recordToolInvocation("pkg-a", "bash");
			c.recordToolResult("pkg-a", "bash", 100, false);
			c.recordTokens("pkg-a", { input: 500, output: 300 });

			const snapshot = c.getSnapshot();

			const c2 = new TelemetryCollector();
			c2.fromSnapshot(snapshot);

			const restored = c2.getSnapshot();
			assert.equal(restored.packages["pkg-a"]!.totalInvocations, 1);
			assert.equal(restored.packages["pkg-a"]!.inputTokens, 500);
			assert.equal(restored.totalTokens, 800);
		});
	});

	describe("reset", () => {
		it("clears all telemetry data", () => {
			const c = new TelemetryCollector();
			c.recordToolInvocation("pkg-a", "bash");
			c.recordTokens("pkg-a", { input: 500, output: 300 });
			c.reset();

			const snapshot = c.getSnapshot();
			assert.equal(Object.keys(snapshot.packages).length, 0);
			assert.equal(snapshot.totalInvocations, 0);
			assert.equal(snapshot.totalTokens, 0);
		});
	});

	describe("setVersion", () => {
		it("updates version for a package", () => {
			const c = new TelemetryCollector();
			c.recordToolInvocation("test-pkg", "read");
			c.setVersion("test-pkg", "2.0.0");

			assert.equal(c.getSnapshot().packages["test-pkg"]!.version, "2.0.0");
		});
	});
});
