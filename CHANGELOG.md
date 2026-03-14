# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
- Heredoc content is now shown inline in the approval prompt (e.g. `bash <<EOF↵echo hi↵EOF`), with newlines replaced by `↵`, content elided at `commandDisplayArgMaxLength` if too long, and the closing marker shown when it fits.

### Fixed
- Fixed display corruption for commands inside `$()` substitutions.

### Changed
- Increased default `commandDisplayMaxLength` from `64` to `120` and `commandDisplayArgMaxLength` from `20` to `40` for better readability on modern wide terminals.
- Replaced prefix-based path detection with a character-composition heuristic that correctly elides bare relative paths (e.g. `packages/tui/src/terminal.ts`) and quoted paths containing `$` while leaving URLs and prose untouched.

## [1.2.0] - 2026-03-12

### Added
- Session-scoped approval: confirmation prompt now offers "Always allow X (this session)" to allow a base command for the duration of the session without persisting to `settings.json`.
- `/unbash list` now shows session-allowed commands alongside permanently allowed commands.
- Smart command display: the command name is always shown verbatim. Path arguments (starting with `/`, `~/`, `./`, or `../`) get path-aware elision (e.g. `/Users/jdiamond/code/pi-unbash` → `/Users/…/pi-unbash`). Other long arguments are prefix-truncated at `commandDisplayArgMaxLength` chars with `…`. If the total display exceeds `commandDisplayMaxLength`, the whole string is hard-truncated. Original quoting is preserved and whitespace is normalized via per-argument source positions from the AST.
- `commandDisplayMaxLength` and `commandDisplayArgMaxLength` settings in `settings.json` control the total display budget and per-argument truncation length (defaults: `120` and `40`).
- Added `sort` and `uniq` to the default allowed commands.

### Changed
- Confirmation prompt now uses a select dialog with `Allow`, `Always allow X (this session)`, and `Reject` options instead of a yes/no confirm dialog.
- Extracted default allowlist to `src/defaults.ts`; README links to it instead of repeating the list.

## [1.1.0] - 2026-03-11

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
- AST traversal now correctly detects commands inside `if`, `while`, `for`, `case`, function bodies, and brace groups; also fixed `CommandExpansion` nodes being silently missed due to non-enumerable prototype getters in `unbash`'s `WordImpl`.
- Command extraction for subshells inside double-quoted strings.
- `/unbash allow` and `/unbash deny` parsing for multi-token commands.
- Runtime validation for `unbash` settings loaded from `~/.pi/agent/settings.json`.
- Safe fallback behavior for invalid config shape/fields (`enabled: true`, `alwaysAllowed: []`) to avoid permissive misconfiguration.
- One-time warning surfacing (console + UI notification when available) for invalid loaded config.
- Parse failures and tolerant parse errors (`ast.errors`) now fall back to UI confirmation instead of unconditional blocking; confirmation prompts for parse errors use minimal copy (no command echo).

## [1.0.0] - 2026-03-10
### Added
- Initial public release of `pi-unbash`.
