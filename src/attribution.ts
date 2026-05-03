/**
 * TokenAttribution — equal-share token/cost attribution strategy.
 *
 * Separates the attribution logic from the Telemetry class so it can be
 * tested independently and swapped for alternative strategies.
 */

import type { TelemetryCollector } from "./collector.ts";
import type { PackageRegistry } from "./registry.ts";

/** Token usage data from an LLM response. */
export interface TokenUsage {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
}

/** Cost data from an LLM response. */
export interface CostUsage {
	total?: number;
}

/** Attribution result for a single package. */
export interface AttributionSlice {
	tokens: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
	};
	cost: number;
}

/**
 * TokenAttributionStrategy — interface for attribution algorithms.
 *
 * Implementations divide token/cost usage among registered packages.
 */
export interface TokenAttributionStrategy {
	/**
	 * Compute per-package attribution slices from total usage.
	 * @param packageCount — number of registered packages to split among
	 * @param usage — total token/cost usage from the LLM
	 */
	allocate(packageCount: number, usage: { tokens?: TokenUsage; cost?: CostUsage }): AttributionSlice[];
}

// ── Default strategy: equal share ──────────────────────────────────────

/**
 * EqualShareStrategy — distributes tokens and cost equally among all packages.
 *
 * This gives directional insight, not audit-grade accuracy. Fine for
 * monitoring relative cost trends across extensions.
 */
export class EqualShareStrategy implements TokenAttributionStrategy {
	allocate(packageCount: number, usage: { tokens?: TokenUsage; cost?: CostUsage }): AttributionSlice[] {
		if (packageCount === 0) return [];
		const share = 1 / packageCount;
		const slices: AttributionSlice[] = [];

		for (let i = 0; i < packageCount; i++) {
			slices.push({
				tokens: {
					input: Math.round((usage.tokens?.input ?? 0) * share),
					output: Math.round((usage.tokens?.output ?? 0) * share),
					cacheRead: Math.round((usage.tokens?.cacheRead ?? 0) * share),
					cacheWrite: Math.round((usage.tokens?.cacheWrite ?? 0) * share),
				},
				cost: usage.cost?.total ? usage.cost.total * share : 0,
			});
		}

		return slices;
	}
}

// ── Applier — connects strategy to collector/registry ──────────────────

/**
 * Apply attribution to the collector using the given strategy.
 */
export function applyAttribution(
	registry: PackageRegistry,
	collector: TelemetryCollector,
	strategy: TokenAttributionStrategy,
	usage: { tokens?: TokenUsage; cost?: CostUsage },
): void {
	const packages = registry.list();
	if (packages.length === 0) return;

	const slices = strategy.allocate(packages.length, usage);

	for (let i = 0; i < packages.length; i++) {
		const pkg = packages[i];
		const slice = slices[i];
		collector.recordTokens(pkg.name, slice.tokens);
		if (slice.cost > 0) {
			collector.recordCost(pkg.name, slice.cost);
		}
	}
}
