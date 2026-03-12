# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased] (1.1.0)

### Added
- Subcommand-level allowlist support (for example, allowing `git status` without allowing all `git` commands).
- Subsequence-based allowlist matching so required tokens can be enforced while still permitting extra flags/arguments.

### Changed
- Added `cd` to the default always-allowed command set.
- Updated README examples/documentation for subcommand matching behavior.

### Fixed
- Command extraction for subshells inside double-quoted strings.
- `/unbash allow` and `/unbash deny` parsing for multi-token commands.

## [1.0.0] - 2026-03-10
### Added
- Initial public release of `pi-unbash`.
