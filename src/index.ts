/**
 * pi-telemetry — Monitoring and telemetry framework for pi extensions.
 *
 * Entry point. Registers the telemetry extension, hooks into session lifecycle,
 * and provides a public API for other extensions.
 *
 * Usage:
 *   import telemetry from "pi-telemetry";
 *   export default function (pi) { telemetry(pi); }
 *
 * Other extensions can import getTelemetry() to access registry/collector:
 *   import { getTelemetry } from "pi-telemetry";
 *   const t = getTelemetry();
 *   t?.register({ name: "my-ext", version: "1.0.0", description: "..." });
 *   t?.heartbeat("my-ext");
 *   t?.notify("Done!", { package: "my-ext", severity: "success" });
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { PackageRegistry } from "./registry.ts";
import { TelemetryCollector } from "./collector.ts";
import { MessageBus } from "./bus.ts";
import { registerTelemetryMessageRenderer, notify } from "./renderer.ts";
import { registerTelemetryWidget } from "./widget.ts";
import { registerTelemetryCommands } from "./commands.ts";
import type {
	PackageRegistration,
	PackageStatus,
	NotifyOptions,
} from "./types.ts";

// ── Module-level singleton ──────────────────────────────────────────────

let instance: Telemetry | null = null;

/**
 * Get the active Telemetry instance. Returns null if not yet initialized
 * or if the session is in a non-telemetry profile.
 */
export function getTelemetry(): Telemetry | null {
	return instance;
}

// ── Telemetry Class ─────────────────────────────────────────────────────

export class Telemetry {
	public readonly registry: PackageRegistry;
	public readonly collector: TelemetryCollector;
	public readonly bus: MessageBus;
	private readonly pi: ExtensionAPI;

	constructor(pi: ExtensionAPI) {
		this.pi = pi;
		this.registry = new PackageRegistry();
		this.collector = new TelemetryCollector();
		this.bus = new MessageBus(pi.events);

		// Register UI components
		registerTelemetryMessageRenderer(pi);
		registerTelemetryWidget(pi, this.registry);
		registerTelemetryCommands(pi, this.registry, this.collector);

		// Hook into message_end for token/cost attribution
		pi.on("message_end", (_event, _ctx) => {
			this.handleMessageEnd(_event);
		});

		// Reset on new session
		pi.on("session_start", () => {
			this.collector.reset();
		});

		// Record session end on shutdown
		pi.on("session_shutdown", () => {
			this.collector.recordSessionEnd();
		});
	}

	// ── Public API ─────────────────────────────────────────────────────

	/**
	 * Register a package. Should be called during extension load.
	 */
	register(pkg: PackageRegistration): void {
		this.registry.register(pkg);
		this.collector.setVersion(pkg.name, pkg.version);
	}

	/**
	 * Deregister a package.
	 */
	deregister(name: string): void {
		this.registry.deregister(name);
	}

	/**
	 * Send a heartbeat for a package. Keeps the package "alive" in health checks.
	 */
	heartbeat(name: string, opts?: { status?: PackageStatus; error?: string }): void {
		this.registry.heartbeat(name, opts);
		this.collector.setHeartbeat(name, Date.now(), this.registry.get(name)?.status ?? "healthy");
	}

	/**
	 * Send a styled notification to the session TUI.
	 */
	notify(message: string, opts?: NotifyOptions): void {
		notify(this.pi, message, opts);
	}

	/**
	 * Record a tool invocation for a package.
	 */
	recordToolInvocation(pkgName: string, tool: string): void {
		this.collector.recordToolInvocation(pkgName, tool);
	}

	/**
	 * Record a tool result (duration, error status).
	 */
	recordToolResult(pkgName: string, tool: string, duration: number, isError: boolean): void {
		this.collector.recordToolResult(pkgName, tool, duration, isError);
	}

	/**
	 * Record token attribution for a package.
	 */
	recordTokens(pkgName: string, tokens: { input: number; output: number; cacheRead?: number; cacheWrite?: number }): void {
		this.collector.recordTokens(pkgName, tokens);
	}

	/**
	 * Record cost attribution for a package.
	 */
	recordCost(pkgName: string, cost: number): void {
		this.collector.recordCost(pkgName, cost);
	}

	/**
	 * Record an error for a package.
	 */
	recordError(pkgName: string, type: string, message: string, stack?: string): void {
		this.collector.recordError(pkgName, type, message, stack);
	}

	/**
	 * Get active package count.
	 */
	get packageCount(): number {
		return this.registry.list().length;
	}

	// ── Internal ──────────────────────────────────────────────────────

	private handleMessageEnd(event: { message?: { role?: string; usage?: { tokens?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number }; cost?: { total?: number } } } }): void {
		if (event.message?.role !== "assistant") return;
		const usage = event.message.usage;
		if (!usage?.tokens) return;

		const packages = this.registry.list();
		if (packages.length === 0) return;

		// Simple equal attribution among all registered packages
		const share = 1 / packages.length;

		for (const pkg of packages) {
			const tokens = {
				input: Math.round((usage.tokens?.input ?? 0) * share),
				output: Math.round((usage.tokens?.output ?? 0) * share),
				cacheRead: Math.round((usage.tokens?.cacheRead ?? 0) * share),
				cacheWrite: Math.round((usage.tokens?.cacheWrite ?? 0) * share),
			};
			this.collector.recordTokens(pkg.name, tokens);

			if (usage.cost?.total) {
				this.collector.recordCost(pkg.name, usage.cost.total * share);
			}
		}
	}
}

// ── Default Export ──────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	instance = new Telemetry(pi);
}
