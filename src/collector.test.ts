/**
 * TelemetryCollector — Tests
 *
 * Includes existing tests plus new tests for domain events, metrics,
 * and sessionEnd fixes.
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

		it("tracks error history entries", () => {
			const c = new TelemetryCollector();
			c.recordError("test-pkg", "timeout", "Timed out");
			c.recordError("test-pkg", "crash", "Crashed", "stack trace");

			const pkg = c.getSnapshot().packages["test-pkg"]!;
			assert.equal(pkg.errorHistory.length, 2);
			assert.equal(pkg.errorHistory[0]!.type, "timeout");
			assert.equal(pkg.errorHistory[0]!.message, "Timed out");
			assert.equal(pkg.errorHistory[1]!.type, "crash");
			assert.equal(pkg.errorHistory[1]!.stack, "stack trace");
		});

		it("caps error history at MAX_ERROR_HISTORY", () => {
			const c = new TelemetryCollector();
			for (let i = 0; i < 15; i++) {
				c.recordError("test-pkg", "err", `Error ${i}`);
			}

			const pkg = c.getSnapshot().packages["test-pkg"]!;
			assert.equal(pkg.errorHistory.length, 10);
			assert.equal(pkg.errorHistory[0]!.message, "Error 5");
			assert.equal(pkg.errorHistory[9]!.message, "Error 14");
		});
	});

	describe("recordEvent", () => {
		it("stores domain events and includes them in snapshot", () => {
			const c = new TelemetryCollector();
			c.recordEvent("pi-scope", "injection", "dep-context injected", { tokens: 2400, files: ["src/auth.ts"] });

			const snapshot = c.getSnapshot();
			assert.equal(snapshot.events.length, 1);
			assert.equal(snapshot.events[0]!.package, "pi-scope");
			assert.equal(snapshot.events[0]!.type, "injection");
			assert.equal(snapshot.events[0]!.label, "dep-context injected");
			assert.equal(snapshot.events[0]!.data?.tokens, 2400);
		});

		it("filters events by package and type", () => {
			const c = new TelemetryCollector();
			c.recordEvent("pkg-a", "injection", "injected");
			c.recordEvent("pkg-b", "pruning", "pruned");
			c.recordEvent("pkg-a", "pruning", "pruned too");

			assert.equal(c.getEvents("pkg-a").length, 2);
			assert.equal(c.getEvents("pkg-a", "pruning").length, 1);
			assert.equal(c.getEvents(undefined, "pruning").length, 2);
		});

		it("caps events at MAX_DOMAIN_EVENTS", () => {
			const c = new TelemetryCollector();
			for (let i = 0; i < 510; i++) {
				c.recordEvent("pkg", "type", `event ${i}`);
			}
			assert.equal(c.getEvents().length, 500);
		});
	});

	describe("recordMetric", () => {
		it("stores metric values", () => {
			const c = new TelemetryCollector();
			c.recordMetric("tokens-saved", 1000, { cumulative: true });
			c.recordMetric("tokens-saved", 2000, { cumulative: true });

			const metrics = c.getMetrics("tokens-saved");
			assert.equal(metrics.length, 2);
			assert.equal(metrics[0]!.value, 1000);
			assert.equal(metrics[1]!.value, 2000);
		});

		it("computes metric summaries correctly", () => {
			const c = new TelemetryCollector();
			c.recordMetric("test-ratio", 0.5, { cumulative: false });
			c.recordMetric("test-ratio", 0.7, { cumulative: false });
			c.recordMetric("test-ratio", 0.9, { cumulative: false });

			const summaries = c.getMetricSummaries();
			assert.equal(summaries.length, 1);
			assert.equal(summaries[0]!.name, "test-ratio");
			assert.equal(summaries[0]!.count, 3);
			assert.equal(summaries[0]!.min, 0.5);
			assert.equal(summaries[0]!.max, 0.9);
			assert(Math.abs(summaries[0]!.average - 0.7) < 0.0001);
			assert.equal(summaries[0]!.lastValue, 0.9);
		});

		it("returns metric names", () => {
			const c = new TelemetryCollector();
			c.recordMetric("tokens-saved", 1000);
			c.recordMetric("dep-context-triggers", 5);

			const names = c.getMetricNames();
			assert(names.includes("tokens-saved"));
			assert(names.includes("dep-context-triggers"));
		});
	});

	describe("getSnapshot / fromSnapshot", () => {
		it("getSnapshot returns full state with sessionEnd, events, metrics", () => {
			const c = new TelemetryCollector();
			c.recordToolInvocation("pkg-a", "bash");
			c.recordToolResult("pkg-a", "bash", 100, false);
			c.recordTokens("pkg-a", { input: 500, output: 300 });
			c.recordCost("pkg-a", 0.005);
			c.recordEvent("pkg-a", "injection", "test injection");
			c.recordMetric("test-metric", 42);
			c.recordSessionEnd();

			const snapshot = c.getSnapshot();
			assert(snapshot.sessionStart > 0);
			assert(snapshot.sessionEnd !== undefined);
			assert(snapshot.sessionEnd! >= snapshot.sessionStart);
			assert(snapshot.packages["pkg-a"]);
			assert.equal(snapshot.events.length, 1);
			assert(snapshot.metrics["test-metric"]);
			assert.equal(snapshot.totalInvocations, 1);
			assert.equal(snapshot.totalTokens, 800);
			assert.equal(snapshot.totalCost, 0.005);
		});

		it("fromSnapshot restores state correctly", () => {
			const c = new TelemetryCollector();
			c.recordToolInvocation("pkg-a", "bash");
			c.recordToolResult("pkg-a", "bash", 100, false);
			c.recordTokens("pkg-a", { input: 500, output: 300 });
			c.recordEvent("pkg-a", "injection", "test");
			c.recordMetric("m1", 10);
			c.recordSessionEnd();

			const snapshot = c.getSnapshot();

			const c2 = new TelemetryCollector();
			c2.fromSnapshot(snapshot);

			const restored = c2.getSnapshot();
			assert.equal(restored.packages["pkg-a"]!.totalInvocations, 1);
			assert.equal(restored.packages["pkg-a"]!.inputTokens, 500);
			assert.equal(restored.totalTokens, 800);
			assert.equal(restored.sessionEnd, snapshot.sessionEnd);
		});
	});

	describe("reset", () => {
		it("clears all telemetry data including events and metrics", () => {
			const c = new TelemetryCollector();
			c.recordToolInvocation("pkg-a", "bash");
			c.recordTokens("pkg-a", { input: 500, output: 300 });
			c.recordEvent("pkg-a", "test", "event");
			c.recordMetric("m1", 10);
			c.reset();

			const snapshot = c.getSnapshot();
			assert.equal(Object.keys(snapshot.packages).length, 0);
			assert.equal(snapshot.totalInvocations, 0);
			assert.equal(snapshot.totalTokens, 0);
			assert.equal(snapshot.events.length, 0);
			assert.equal(Object.keys(snapshot.metrics).length, 0);
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
