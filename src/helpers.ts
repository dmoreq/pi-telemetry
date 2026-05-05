/**
 * Telemetry Helpers — ergonomic wrappers around getTelemetry().
 *
 * All functions are safe no-ops when telemetry is not loaded.
 * Designed to replace duplicated helpers in pi-scope and pi-me.
 *
 * Usage:
 *   import { recordEvent, recordMetric, registerPackage, telemetryHeartbeat } from 'pi-telemetry/helpers';
 */

import { getTelemetry } from './index.ts';
import type { PackageRegistration, NotifyOptions } from './types.ts';

/**
 * Register a package and send initial heartbeat in one call.
 * Safe no-op when telemetry is not loaded.
 */
export function registerPackage(reg: PackageRegistration): void {
	const t = getTelemetry();
	if (!t) return;
	t.register(reg);
	t.heartbeat(reg.name);
}

/**
 * Send a badge notification only when telemetry is active.
 * Safe no-op when telemetry is not loaded.
 */
export function telemetryNotify(message: string, opts?: NotifyOptions): void {
	getTelemetry()?.notify(message, opts);
}

/**
 * Send a heartbeat only when telemetry is active.
 * Safe no-op when telemetry is not loaded.
 */
export function telemetryHeartbeat(name: string, opts?: { status?: import('./types.ts').PackageStatus; error?: string }): void {
	getTelemetry()?.heartbeat(name, opts);
}

/**
 * Record a structured domain event.
 * Safe no-op when telemetry is not loaded.
 *
 * Use for non-tool activity: context injections, pruning, task captures,
 * automation triggers, format runs, etc.
 */
export function recordEvent(pkgName: string, type: string, label: string, data?: Record<string, unknown>): void {
	getTelemetry()?.recordEvent(pkgName, type, label, data);
}

/**
 * Record a numeric metric value.
 * Safe no-op when telemetry is not loaded.
 *
 * Use for counters, gauges, ratios that are not tool-invocation based.
 */
export function recordMetric(name: string, value: number, opts?: { cumulative?: boolean; tags?: Record<string, string> }): void {
	getTelemetry()?.recordMetric(name, value, opts);
}

/**
 * Record an error with error-history tracking.
 * Safe no-op when telemetry is not loaded.
 */
export function recordError(pkgName: string, type: string, message: string, stack?: string): void {
	getTelemetry()?.recordError(pkgName, type, message, stack);
}

/**
 * Record a tool invocation + result + tokens in one call.
 * Safe no-op when telemetry is not loaded.
 *
 * Convenience wrapper for the common "I did something and it consumed tokens" pattern.
 */
export function recordToolUsage(pkgName: string, tool: string, tokens: number, duration: number, isError: boolean): void {
	const t = getTelemetry();
	if (!t) return;
	t.recordToolInvocation(pkgName, tool);
	t.recordToolResult(pkgName, tool, duration, isError);
	if (tokens > 0) {
		t.recordTokens(pkgName, { input: tokens, output: 0 });
	}
}
