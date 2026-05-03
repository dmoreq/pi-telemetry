/**
 * pi-telemetry — Type definitions
 *
 * All interfaces for the package registry, telemetry collector,
 * message bus, and session UI/UX layer.
 */

// ── Package Registry Types ──────────────────────────────────────────────

export type PackageStatus = "healthy" | "degraded" | "error" | "stale";

export interface PackageRegistration {
	/** Unique package name, e.g. "read-guard" */
	name: string;
	/** Semver version, e.g. "1.0.0" */
	version: string;
	/** Short description of the package */
	description: string;
	/** Tools this package registers or intercepts */
	tools?: string[];
	/** Session/agent events this package subscribes to */
	events?: string[];
	/** Lifecycle hooks used */
	hooks?: string[];
}

export interface RegisteredPackage extends PackageRegistration {
	/** Timestamp when the package was registered */
	registeredAt: number;
	/** Timestamp of the last heartbeat */
	lastHeartbeat: number;
	/** Current health status */
	status: PackageStatus;
	/** Last error (if any) */
	lastError?: PackageError;
	/** Total tool invocations attributed to this package */
	invocations: number;
	/** Total estimated cost attributed to this package */
	totalCost: number;
}

export interface PackageError {
	/** Error type, e.g. "timeout", "validation", "crash" */
	type: string;
	/** Human-readable error message */
	message: string;
	/** Timestamp when the error occurred */
	timestamp: number;
	/** Number of times this type of error has been reported */
	count: number;
}

// ── Telemetry Types ─────────────────────────────────────────────────────

export interface ToolTelemetry {
	/** Total invocations of this tool */
	invocations: number;
	/** Total errors from this tool */
	errors: number;
	/** Average execution duration in ms */
	avgDurationMs: number;
	/** 95th percentile execution duration in ms */
	p95DurationMs: number;
	/** Maximum execution duration in ms */
	maxDurationMs: number;
	/** Rolling window of the last 100 execution times */
	executionTimes: number[];
}

export interface PackageTelemetry {
	/** Package name */
	name: string;
	/** Package version */
	version: string;
	/** Total tool invocations */
	totalInvocations: number;
	/** Total errors */
	totalErrors: number;
	/** Error rate (errors / invocations, 0 if no invocations) */
	errorRate: number;
	/** Total input tokens attributed */
	inputTokens: number;
	/** Total output tokens attributed */
	outputTokens: number;
	/** Total cache-read tokens attributed */
	cacheReadTokens: number;
	/** Total cache-write tokens attributed */
	cacheWriteTokens: number;
	/** Total tokens (input + output + cache) */
	totalTokens: number;
	/** Estimated cost in USD */
	estimatedCost: number;
	/** Total execution time in ms */
	totalExecutionMs: number;
	/** Average execution time in ms */
	avgExecutionMs: number;
	/** Maximum execution time in ms */
	maxExecutionMs: number;
	/** Per-tool breakdown */
	tools: Record<string, ToolTelemetry>;
	/** Timestamp of last heartbeat */
	lastHeartbeat: number;
	/** Current health status */
	status: PackageStatus;
	/** Last error (if any) */
	lastError?: PackageError;
}

export interface SessionTelemetry {
	/** Session start timestamp */
	sessionStart: number;
	/** Session end timestamp (optional) */
	sessionEnd?: number;
	/** Per-package telemetry data */
	packages: Record<string, PackageTelemetry>;
	/** Total tokens across all packages */
	totalTokens: number;
	/** Total cost across all packages */
	totalCost: number;
	/** Total invocations across all packages */
	totalInvocations: number;
	/** Total errors across all packages */
	totalErrors: number;
}

// ── Message Bus Types ───────────────────────────────────────────────────

export type TelemetryChannel =
	| "pi-telemetry:package:register"
	| "pi-telemetry:package:deregister"
	| "pi-telemetry:package:heartbeat"
	| "pi-telemetry:tool:invoke"
	| "pi-telemetry:tool:result"
	| "pi-telemetry:cost:attribution"
	| "pi-telemetry:error:report"
	| "pi-telemetry:ui:notify";

export interface TelemetryMessage<T = unknown> {
	/** The channel this message was published on */
	channel: TelemetryChannel;
	/** The message payload */
	payload: T;
	/** Timestamp when the message was published */
	timestamp: number;
	/** Source package name */
	source: string;
}

// ── UI Types ────────────────────────────────────────────────────────────

export type BadgeVariant = "info" | "success" | "warning" | "danger" | "primary" | "secondary" | "light";

export interface NotifyOptions {
	/** Package name (shown as badge label) */
	package?: string;
	/** Severity level (maps to badge variant) */
	severity?: "info" | "success" | "warning" | "error";
	/** Custom badge configuration */
	badge?: {
		text: string;
		variant: BadgeVariant;
	};
	/** Additional details for expanded view */
	details?: Record<string, unknown>;
}

// ── Bus Payloads ────────────────────────────────────────────────────────

export interface PackageRegisterPayload {
	name: string;
	version: string;
	description: string;
	tools?: string[];
	events?: string[];
	hooks?: string[];
}

export interface PackageDeregisterPayload {
	name: string;
}

export interface PackageHeartbeatPayload {
	name: string;
	status: PackageStatus;
	timestamp: number;
	error?: string;
}

export interface ToolInvokePayload {
	package: string;
	tool: string;
	args?: Record<string, unknown>;
	timestamp: number;
}

export interface ToolResultPayload {
	package: string;
	tool: string;
	duration: number;
	isError: boolean;
	error?: string;
}

export interface CostAttributionPayload {
	package: string;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	cost: number;
}

export interface ErrorReportPayload {
	package: string;
	type: string;
	message: string;
	stack?: string;
}

export interface UINotifyPayload {
	package: string;
	severity: "info" | "success" | "warning" | "error";
	message: string;
	badge?: {
		text: string;
		variant: BadgeVariant;
	};
	details?: Record<string, unknown>;
}
