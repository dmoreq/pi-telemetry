# Contributing to pi-telemetry

Thank you for considering contributing to pi-telemetry! We welcome contributions of all kinds: bug reports, feature requests, documentation improvements, and code changes.

## Code of Conduct

This project follows a **Contributor Covenant** code of conduct. By participating, you agree to maintain a respectful and inclusive environment.

## How to Contribute

### Reporting Bugs

1. Search [existing issues](https://github.com/dmoreq/pi-telemetry/issues) first.
2. If no existing issue covers it, [create a new issue](https://github.com/dmoreq/pi-telemetry/issues/new).
3. Include:
   - A clear, descriptive title
   - Steps to reproduce
   - Expected vs actual behavior
   - Environment info (Node version, OS, pi version)

### Suggesting Features

1. Describe the problem you want to solve, not just your proposed solution.
2. Explain why the feature would be useful to other extension authors.
3. Label the issue with "enhancement".

### Pull Requests

1. **Fork** the repository and create a branch from `main`.
2. Use consistent branch naming:
   - `feat/my-feature` for new features
   - `fix/my-bugfix` for bug fixes
   - `docs/my-change` for documentation
   - `refactor/my-change` for refactoring
3. Follow existing code style (TypeScript, 2-space indent, etc.).
4. Write or update tests for your changes.
5. Ensure all tests pass (`npm test`).
6. Keep PRs focused — one change per PR.
7. Write clear commit messages following [Conventional Commits](https://www.conventionalcommits.org/):
   - `feat: add new feature`
   - `fix: correct wrong behavior`
   - `docs: update API docs`
   - `refactor: extract formatting helpers`
   - `test: add coverage for edge cases`

### Development Setup

```bash
git clone git@github.com:dmoreq/pi-telemetry.git
cd pi-telemetry
npm install --include=dev
npm test
```

### Code Style

- **Language**: TypeScript (strict mode)
- **Formatting**: 2-space indentation, semicolons
- **Exports**: Named exports for classes/functions, default export for entry point
- **Tests**: Use Node's built-in `node:test` and `node:assert/strict`
- **Documentation**: JSDoc comments on all public APIs

## Project Structure

```
pi-telemetry/
├── src/
│   ├── index.ts           — Entry point, Telemetry class
│   ├── types.ts           — TypeScript interfaces and types
│   ├── registry.ts        — PackageRegistry
│   ├── collector.ts       — TelemetryCollector (data store)
│   ├── bus.ts             — MessageBus (typed pub/sub)
│   ├── attribution.ts     — TokenAttributionStrategy, EqualShareStrategy
│   ├── format.ts          — Shared formatting helpers
│   ├── commands.ts        — /telemetry, /health commands
│   ├── renderer.ts        — Badge-style message renderer
│   ├── widget.ts          — Health-dot status widget
│   ├── registry.test.ts   — PackageRegistry tests
│   ├── collector.test.ts  — TelemetryCollector tests
│   └── renderer.test.ts   — Message renderer tests
├── package.json
├── tsconfig.json
├── README.md
├── CONTRIBUTING.md
└── LICENSE
```

## Questions?

Open a [discussion](https://github.com/dmoreq/pi-telemetry/discussions) or issue.
