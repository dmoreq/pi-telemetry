# pi-telemetry

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Monitoring and telemetry framework for [pi](https://github.com/mariozechner/pi-coding-agent) extensions. Track usage, estimate costs, monitor errors, and display badge-style notifications in the session TUI.

## Features

- **Package Registry** — Extensions self-register with metadata. Health status via heartbeats.
- **Usage Tracking** — Per-package and per-tool invocation counters.
- **Cost Attribution** — Proportional token/cost tracking from LLM usage data.
- **Error Monitoring** — Error types, counts, timestamps per package.
- **Performance Timing** — Average, max, and p95 execution times per tool.
- **Badge-Style Notifications** — Replace raw `ctx.ui.notify()` with styled `[package] ✓ message` output.
- **Health Widget** — Live health-dot status bar (`📊 ◉ read-guard ◉ plan-mode ...`).
- **Commands** — `/telemetry` dashboard, `/telemetry export`, `/health`.

## Installation

### As a pi package

```bash
pi install git:github.com/dmoreq/pi-telemetry
```

### As an npm dependency

```json
{
  "dependencies": {
    "pi-telemetry": "github:dmoreq/pi-telemetry"
  }
}
```

## Quick Start

### 1. Load in your extension

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import telemetry, { getTelemetry } from "pi-telemetry";

export default function (pi: ExtensionAPI) {
  // Load telemetry first
  telemetry(pi);

  // Get the singleton instance
  const t = getTelemetry()!;

  // Register your package
  t.register({
    name: "my-extension",
    version: "1.0.0",
    description: "My awesome extension",
    tools: ["my-tool"],
    events: ["tool_call"],
  });
}
```

> **Important**: `telemetry(pi)` must be called before your extension registers
> any tools. It sets up the message renderer, widget, and commands.

### 2. Send heartbeats

```typescript
// In critical code paths:
t.heartbeat("my-extension");

// On error:
t.heartbeat("my-extension", {
  status: "error",
  error: "Failed to process request",
});
```

### 3. Send styled notifications

```typescript
// Instead of: ctx.ui.notify("Done!", "success");
t.notify("Package loaded successfully", {
  package: "my-extension",
  severity: "success",
  badge: { text: "v1.0.0", variant: "info" },
});

t.notify("Edit blocked — no prior read", {
  package: "my-extension",
  severity: "warning",
  badge: { text: "BLOCKED", variant: "warning" },
});

t.notify("Something went wrong", {
  package: "my-extension",
  severity: "error",
});
```

### 4. Record tool usage

```typescript
t.recordToolInvocation("my-extension", "my-tool");
t.recordToolResult("my-extension", "my-tool", durationMs, isError);
```

## API Reference

### `Telemetry` (main class)

| Method | Description |
|--------|-------------|
| `register(pkg)` | Register a package |
| `deregister(name)` | Remove a package |
| `heartbeat(name, opts?)` | Send heartbeat (keeps package "alive") |
| `notify(message, opts?)` | Send styled notification |
| `recordToolInvocation(pkg, tool)` | Count a tool invocation |
| `recordToolResult(pkg, tool, duration, isError)` | Record tool timing |
| `recordTokens(pkg, {input, output, cacheRead?, cacheWrite?})` | Attribute tokens |
| `recordCost(pkg, cost)` | Attribute cost (USD) |
| `recordError(pkg, type, message, stack?)` | Record an error |

### `PackageRegistration`

```typescript
interface PackageRegistration {
  name: string;        // Unique package name, e.g. "read-guard"
  version: string;     // Semver, e.g. "1.0.0"
  description: string; // Short description
  tools?: string[];    // Tools this package registers/intercepts
  events?: string[];   // Events subscribed to
  hooks?: string[];    // Lifecycle hooks used
}
```

### `NotifyOptions`

```typescript
interface NotifyOptions {
  package?: string;                    // Badge label
  severity?: "info" | "success" | "warning" | "error";
  badge?: {
    text: string;                      // Badge text
    variant: BadgeVariant;             // "info" | "success" | "warning" | "danger" | "primary" | "secondary" | "light"
  };
  details?: Record<string, unknown>;   // Expanded view data
}
```

## Badge Variants

| Variant | Theme Color | Bootstrap Equivalent | Use Case |
|---------|-------------|---------------------|----------|
| `info` | `accent` | `badge bg-info` | General info |
| `success` | `success` | `badge bg-success` | Success |
| `warning` | `warning` | `badge bg-warning` | Warnings, blocks |
| `danger` | `error` | `badge bg-danger` | Errors |
| `primary` | `toolTitle` | `badge bg-primary` | Actions |
| `secondary` | `muted` | `badge bg-secondary` | Secondary info |
| `light` | default | `badge bg-light` | Subtle context |

## Commands

### `/telemetry`

Interactive dashboard showing per-package usage, errors, cost, and health.

```
📊 Telemetry Dashboard

Package           Invs    Errors   Cost     Health
─────────────────────────────────────────────────────
read-guard         28       3      $0.02    ◉ healthy
plan-mode          12       0      $0.01    ◉ healthy
memory             45       1      $0.04    ◉ healthy

Total: $0.07 | 85 invocations | 4 errors
```

### `/telemetry export`

Export telemetry snapshot to `.pi/telemetry/export-<timestamp>.json`.

### `/health`

Quick per-package health overview with heartbeat timing.

```
Health Check (4 packages):

  ◉ read-guard  v1.0.0 — 12s ago
  ◉ plan-mode   v0.2.0 — 8s ago
  ○ ralph-loop  v0.1.0 — stale
  ◉ memory      v0.1.0 — 3s ago
```

## Architecture

```
Telemetry
├── PackageRegistry     — register, heartbeat, health check
├── TelemetryCollector  — usage, tokens, cost, errors, timing
├── MessageBus          — typed pub/sub on pi.events
├── renderer.ts         — badge-style message renderer
├── widget.ts           — health-dot status widget
└── commands.ts         — /telemetry, /health
```

### Message Bus Channels

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `pi-telemetry:package:register` | pkg → framework | Package registration |
| `pi-telemetry:package:deregister` | pkg → framework | Package deregistration |
| `pi-telemetry:package:heartbeat` | pkg → framework | Health heartbeat |
| `pi-telemetry:tool:invoke` | pkg → framework | Tool invocation |
| `pi-telemetry:tool:result` | pkg → framework | Tool result |
| `pi-telemetry:cost:attribution` | framework → all | Token/cost attribution |
| `pi-telemetry:error:report` | pkg → framework | Error report |
| `pi-telemetry:ui:notify` | pkg → framework | UI notification |

### Token Attribution

At each `message_end`, tokens are proportionally attributed to all registered
packages using `packageCost = totalCost / packageCount`. This gives directional
insight, not audit-grade accuracy.

## Integration Guide for Extension Authors

To instrument your extension:

1. **Import telemetry** — Get the singleton via `getTelemetry()`
2. **Register on load** — Call `t.register()` with your package metadata
3. **Send heartbeats** — In critical code paths, call `t.heartbeat()`
4. **Replace notifications** — Swap `ctx.ui.notify()` for `t.notify()`
5. **Record tool usage** — Call `t.recordToolInvocation()` and `t.recordToolResult()`

Example:

```typescript
import { getTelemetry } from "pi-telemetry";

const t = getTelemetry();
t?.register({ name: "my-ext", version: "1.0.0", description: "..." });

// In your tool's execute():
t?.heartbeat("my-ext");
t?.recordToolInvocation("my-ext", "my-tool");
t?.notify("Result", { package: "my-ext", severity: "success" });

t?.recordToolResult("my-ext", "my-tool", duration, isError);
```

## Development

```bash
git clone git@github.com:dmoreq/pi-telemetry.git
cd pi-telemetry
npm install --include=dev  # peer deps are optional
npx tsx --test src/**/*.test.ts
```

## License

MIT
