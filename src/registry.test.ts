/**
 * PackageRegistry — Tests
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PackageRegistry } from "./registry.ts";

describe("PackageRegistry", () => {
	describe("register", () => {
		it("creates entry with healthy status and healthHistory", () => {
			const registry = new PackageRegistry();
			registry.register({
				name: "test-pkg",
				version: "1.0.0",
				description: "Test package",
			});

			const pkg = registry.get("test-pkg");
			assert(pkg);
			assert.equal(pkg.name, "test-pkg");
			assert.equal(pkg.version, "1.0.0");
			assert.equal(pkg.status, "healthy");
			assert.equal(pkg.invocations, 0);
			assert(pkg.registeredAt > 0);
			assert(pkg.lastHeartbeat > 0);
			assert.deepEqual(pkg.healthHistory, ["healthy"]);
		});

		it("includes optional fields", () => {
			const registry = new PackageRegistry();
			registry.register({
				name: "test-pkg",
				version: "1.0.0",
				description: "Test package",
				tools: ["read", "edit"],
				events: ["tool_call"],
				hooks: ["session_start"],
			});

			const pkg = registry.get("test-pkg");
			assert(pkg);
			assert.deepEqual(pkg.tools, ["read", "edit"]);
			assert.deepEqual(pkg.events, ["tool_call"]);
			assert.deepEqual(pkg.hooks, ["session_start"]);
		});
	});

	describe("deregister", () => {
		it("removes a registered package and returns true", () => {
			const registry = new PackageRegistry();
			registry.register({ name: "test-pkg", version: "1.0.0", description: "Test" });
			assert(registry.get("test-pkg"));

			const result = registry.deregister("test-pkg");
			assert.equal(result, true);
			assert.equal(registry.get("test-pkg"), undefined);
		});

		it("returns false for unknown package", () => {
			const registry = new PackageRegistry();
			assert.equal(registry.deregister("nonexistent"), false);
		});
	});

	describe("heartbeat", () => {
		it("updates timestamp and resets error", () => {
			const registry = new PackageRegistry();
			registry.register({ name: "test-pkg", version: "1.0.0", description: "Test" });
			const before = registry.get("test-pkg")!.lastHeartbeat;

			// Wait a tiny bit
			const result = registry.heartbeat("test-pkg");
			assert.equal(result, true);

			const after = registry.get("test-pkg")!.lastHeartbeat;
			assert(after >= before);
			assert.equal(registry.get("test-pkg")!.status, "healthy");
		});

		it("returns false for unknown package", () => {
			const registry = new PackageRegistry();
			assert.equal(registry.heartbeat("nonexistent"), false);
		});

		it("sets error state when error is provided", () => {
			const registry = new PackageRegistry();
			registry.register({ name: "test-pkg", version: "1.0.0", description: "Test" });

			registry.heartbeat("test-pkg", { status: "error", error: "Something broke" });
			const pkg = registry.get("test-pkg")!;
			assert.equal(pkg.status, "error");
			assert(pkg.lastError);
			assert.equal(pkg.lastError!.message, "Something broke");
			assert.equal(pkg.lastError!.count, 1);
		});

		it("increments error count on repeated errors", () => {
			const registry = new PackageRegistry();
			registry.register({ name: "test-pkg", version: "1.0.0", description: "Test" });

			registry.heartbeat("test-pkg", { status: "error", error: "Error 1" });
			registry.heartbeat("test-pkg", { status: "error", error: "Error 2" });
			assert.equal(registry.get("test-pkg")!.lastError!.count, 2);
		});
	});

	describe("list", () => {
		it("returns all registered packages", () => {
			const registry = new PackageRegistry();
			registry.register({ name: "pkg-a", version: "1.0.0", description: "A" });
			registry.register({ name: "pkg-b", version: "2.0.0", description: "B" });
			registry.register({ name: "pkg-c", version: "3.0.0", description: "C" });

			const list = registry.list();
			assert.equal(list.length, 3);
			const names = list.map(p => p.name).sort();
			assert.deepEqual(names, ["pkg-a", "pkg-b", "pkg-c"]);
		});
	});

	describe("health", () => {
		it("returns correct counts for mixed states", () => {
			const registry = new PackageRegistry();
			registry.register({ name: "healthy-pkg", version: "1.0.0", description: "Healthy" });
			registry.heartbeat("healthy-pkg"); // fresh heartbeat → healthy

			// Register and immediately set error
			registry.register({ name: "error-pkg", version: "1.0.0", description: "Error" });
			registry.heartbeat("error-pkg", { status: "error", error: "Broke" });

			const h = registry.health();
			assert.equal(h.healthy, 1);
			assert.equal(h.error, 1);
			assert.equal(h.total, 2);
		});
	});

	describe("trend", () => {
		it("returns stable for packages with no history", () => {
			const registry = new PackageRegistry();
			registry.register({ name: "test-pkg", version: "1.0.0", description: "Test" });
			assert.equal(registry.trend("test-pkg"), "stable");
		});

		it("returns stable for unknown package", () => {
			const registry = new PackageRegistry();
			assert.equal(registry.trend("nonexistent"), "stable");
		});

		it("returns degrading when status worsens", () => {
			const registry = new PackageRegistry();
			registry.register({ name: "test-pkg", version: "1.0.0", description: "Test" });
			registry.heartbeat("test-pkg", { status: "error", error: "Broke" });
			assert.equal(registry.trend("test-pkg"), "degrading");
		});

		it("returns improving when trend improves (manually authored history)", () => {
			const registry = new PackageRegistry();
			registry.register({ name: "test-pkg", version: "1.0.0", description: "Test" });
			// Manually set a healthHistory that shows improvement
			const pkg = registry.get("test-pkg")!;
			pkg.healthHistory = ["error", "error", "healthy", "healthy"];
			assert.equal(registry.trend("test-pkg"), "improving");
		});
	});
});
