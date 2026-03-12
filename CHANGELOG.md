# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased] (1.1.0)

### Added
- Subcommand-level allowlist support (for example, allowing `git status` without allowing all `git` commands).
- Subsequence-based allowlist matching so required tokens can be enforced while still permitting extra flags/arguments.

### Changed
- Added `cd` to the default always-allowed command set.
- Updated README examples/documentation for subcommand matching behavior.
- Simplified unauthorized command display labels to base command names only (for example, `npm` instead of `npm run`).
- Streamlined the UI confirmation prompt copy/layout to match pi's minimal interface (clearer unapproved-command heading, improved spacing, compact command list).

### Fixed
- Command extraction for subshells inside double-quoted strings.
- `/unbash allow` and `/unbash deny` parsing for multi-token commands.
- Runtime validation for `unbash` settings loaded from `~/.pi/agent/settings.json`.
- Safe fallback behavior for invalid config shape/fields (`enabled: true`, `alwaysAllowed: []`) to avoid permissive misconfiguration.
- One-time warning surfacing (console + UI notification when available) for invalid loaded config.

## [1.0.0] - 2026-03-10
### Added
- Initial public release of `pi-unbash`.
