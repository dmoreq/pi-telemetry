/**
 * PackageRegistry — tracks registered extensions, manages heartbeats and health.
 *
 * Each extension registers itself with metadata. The registry computes health
 * status based on heartbeat recency and error state.
 */

import type {
	PackageRegistration,
	RegisteredPackage,
	PackageStatus,
	PackageError,
} from "./types.ts";

// ── Constants ───────────────────────────────────────────────────────────

/** Max packages tracked (LRU eviction on register when full) */
const MAX_PACKAGES = 50;

/** Heartbeat within this many ms → healthy */
const HEARTBEAT_HEALTHY_MS = 60_000;

/** Heartbeat within this many ms → degraded (otherwise stale) */
const HEARTBEAT_DEGRADED_MS = 300_000;

/** Error status lasts this many ms before reverting to time-based status */
const ERROR_TTL_MS = 120_000;

// ── Registry ────────────────────────────────────────────────────────────

export class PackageRegistry {
	private readonly packages = new Map<string, RegisteredPackage>();

	/**
	 * Register a new package. If the registry is full (50+ packages), the
	 * oldest stale package is evicted. Registration sets initial status to "healthy".
	 */
	register(reg: PackageRegistration): void {
		if (this.packages.size >= MAX_PACKAGES && !this.packages.has(reg.name)) {
			// Evict the oldest stale package
			let oldest: { name: string; time: number } | null = null;
			for (const [name, pkg] of this.packages) {
				if (pkg.status === "stale" && (!oldest || pkg.lastHeartbeat < oldest.time)) {
					oldest = { name, time: pkg.lastHeartbeat };
				}
			}
			if (oldest) this.packages.delete(oldest.name);
		}

		const now = Date.now();
		const entry: RegisteredPackage = {
			...reg,
			tools: reg.tools ?? [],
			events: reg.events ?? [],
			hooks: reg.hooks ?? [],
			registeredAt: now,
			lastHeartbeat: now,
			status: "healthy",
			invocations: 0,
			totalCost: 0,
			healthHistory: ["healthy"],
		};
		this.packages.set(reg.name, entry);
	}

	/**
	 * Deregister a package. Returns true if found and removed.
	 */
	deregister(name: string): boolean {
		return this.packages.delete(name);
	}

	/**
	 * Send a heartbeat for a package. Updates timestamp and optionally
	 * sets error status. Returns true if the package is registered.
	 */
	heartbeat(
		name: string,
		opts?: { status?: PackageStatus; error?: string },
	): boolean {
		const pkg = this.packages.get(name);
		if (!pkg) return false;

		const newStatus = this.computeStatus(pkg);
		pkg.lastHeartbeat = Date.now();
		pkg.status = newStatus;

		if (opts?.status) {
			pkg.status = opts.status;
		}

		if (opts?.error) {
			pkg.lastError = {
				type: "runtime",
				message: opts.error,
				timestamp: Date.now(),
				count: (pkg.lastError?.count ?? 0) + 1,
			};
		}

		// Track health history (last 5 statuses for trend detection)
		pkg.healthHistory.push(pkg.status);
		if (pkg.healthHistory.length > 5) {
			pkg.healthHistory = pkg.healthHistory.slice(-5);
		}

		return true;
	}

	/**
	 * Get a registered package by name.
	 */
	get(name: string): RegisteredPackage | undefined {
		return this.packages.get(name);
	}

	/**
	 * List all registered packages with up-to-date status.
	 */
	list(): RegisteredPackage[] {
		const result: RegisteredPackage[] = [];
		for (const pkg of this.packages.values()) {
			pkg.status = this.computeStatus(pkg);
			result.push(pkg);
		}
		return result;
	}

	/**
	 * Count packages by health status.
	 */
	health(): { healthy: number; degraded: number; error: number; stale: number; total: number } {
		const counts = { healthy: 0, degraded: 0, error: 0, stale: 0, total: this.packages.size };
		for (const pkg of this.packages.values()) {
			const status = this.computeStatus(pkg);
			switch (status) {
				case "healthy": counts.healthy++; break;
				case "degraded": counts.degraded++; break;
				case "error": counts.error++; break;
				case "stale": counts.stale++; break;
			}
		}
		return counts;
	}

	/**
	 * Compute health status for a package based on heartbeat recency and errors.
	 */
	private computeStatus(pkg: RegisteredPackage): PackageStatus {
		const now = Date.now();
		const elapsed = now - pkg.lastHeartbeat;

		// If there's a recent error, show error status
		if (pkg.lastError && (now - pkg.lastError.timestamp) < ERROR_TTL_MS) {
			return "error";
		}

		if (elapsed < HEARTBEAT_HEALTHY_MS) return "healthy";
		if (elapsed < HEARTBEAT_DEGRADED_MS) return "degraded";
		return "stale";
	}

	/**
	 * Get health trend for a package based on its health history.
	 * Returns "stable", "improving", or "degrading".
	 */
	trend(name: string): "stable" | "improving" | "degrading" {
		const pkg = this.packages.get(name);
		if (!pkg || pkg.healthHistory.length < 2) return "stable";

		const history = pkg.healthHistory;
		const first = history[0];
		const last = history[history.length - 1];

		const statusWeight = (s: PackageStatus): number => {
			switch (s) {
				case "healthy": return 3;
				case "degraded": return 2;
				case "error": return 1;
				case "stale": return 0;
			}
		};

		const firstW = statusWeight(first);
		const lastW = statusWeight(last);

		if (lastW > firstW) return "improving";
		if (lastW < firstW) return "degrading";
		return "stable";
	}
}
