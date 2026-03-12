# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased] (1.1.0)

### Added
- Subcommand-level allowlist support (for example, allowing `git status` without allowing all `git` commands).
- Subsequence-based allowlist matching so required tokens can be enforced while still permitting extra flags/arguments.
- Added `/unbash list` to display current enabled status and allowlist entries.
- Expanded default allowlist to include `rg`, `head`, `tail`, `wc`, `true`, `basename`, `dirname`, `realpath`, `date`, `file`, `stat`, `uname`, `whoami`, `type`, `which`, `git blame`, `git branch --show-current`, `git diff`, `git log`, `git show`, and `git status`.
- Confirmation prompt now shows a preview of each unapproved command, sliced from the original raw string. Newlines are replaced with `↵` and long commands are truncated at 40 characters with `…`.

### Changed
- Added `cd` to the default always-allowed command set.
- Updated README examples/documentation for subcommand matching behavior.
- Streamlined the UI confirmation prompt copy/layout to match pi's minimal interface (clearer unapproved-command heading, improved spacing, compact command list).

### Fixed
- Command extraction for subshells inside double-quoted strings.
- `/unbash allow` and `/unbash deny` parsing for multi-token commands.
- Runtime validation for `unbash` settings loaded from `~/.pi/agent/settings.json`.
- Safe fallback behavior for invalid config shape/fields (`enabled: true`, `alwaysAllowed: []`) to avoid permissive misconfiguration.
- One-time warning surfacing (console + UI notification when available) for invalid loaded config.
- Parse failures now fall back to UI confirmation instead of unconditional blocking when UI is available.
- Tolerant `unbash` parse errors (`ast.errors`) now trigger the same confirmation fallback in UI mode.
- Parse-error confirmation prompts were simplified to minimal copy (no command echo).

## [1.0.0] - 2026-03-10
### Added
- Initial public release of `pi-unbash`.
