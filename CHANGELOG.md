# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
- Emits a `nudge` event via `pi.events` before each approval prompt so extensions like [`pi-nudge`](https://github.com/jdiamond/pi-nudge) can send a native notification when a command needs approval.

### Changed
- Approval prompts now show the full extracted command sequence with status markers: `✔` for commands already allowed and `✖` for commands that still need approval. This preserves context for compound shell commands like `cd /path && npx tsc --noEmit` while keeping attention on the unapproved steps.

## [2.0.0] - 2026-03-15

### Changed
- **Breaking:** Replaced `alwaysAllowed: string[]` with `rules: Record<string, "allow" | "ask">` in `settings.json`. The new format stores only user-defined overrides — default rules are never written to disk, so updates to the built-in defaults are automatically picked up.
- Default rules are now defined as a `Record<string, "allow" | "ask">` in `src/defaults.ts` and merged with user rules at load time. User rules are appended last so they win (last-match-wins evaluation in insertion order).
- The special pattern `"*"` matches any command, allowing rules like `"*": "allow"` to trust all commands globally.
- `/unbash deny` has been removed. Use `rules` directly in `settings.json` to remove a default rule.
- `/unbash list` now shows default rules and user rules as separate groups.
- `isCommandAllowed` replaced by `resolveCommandAction`, which returns `"allow" | "ask"` instead of a boolean.

## [1.3.0] - 2026-03-15

### Added
- Heredoc content is now shown inline in the approval prompt (e.g. `bash <<EOF↵echo hi↵EOF`), with newlines replaced by `↵`, content elided at `commandDisplayArgMaxLength` if too long, and the closing marker shown when it fits.

### Fixed
- Fixed display corruption for commands inside `$()` substitutions.
- Non-heredoc redirects (`2>&1`, `>out.txt`, `<in.txt`, `2>/dev/null`, etc.) are now included in the approval prompt display. Previously they were silently omitted, as seen with commands like `git rebase -i main --autosquash 2>&1 <<EOF`.
- Fixed `settings.json` loading so a present-but-falsey `unbash` value is validated as invalid config and falls back safely, instead of silently reverting to the permissive default allowlist.
- Fixed command extraction for unquoted heredoc bodies, which can contain executable `$(...)` and backtick substitutions. Quoted heredocs remain inert and are not inspected.

### Changed
- Increased default `commandDisplayMaxLength` from `64` to `120` and `commandDisplayArgMaxLength` from `20` to `40` for better readability on modern wide terminals.
- Replaced prefix-based path detection with a character-composition heuristic that correctly elides bare relative paths (e.g. `packages/tui/src/terminal.ts`) and quoted paths containing `$` while leaving URLs and prose untouched.
- Argument elision is now skipped entirely when the full command fits within `commandDisplayMaxLength`. Elision only kicks in when the total length would exceed the budget, so short commands always show their full paths.
- When shrinking is needed, the formatter now starts from the full command and uses as much of the display budget as possible, shrinking later tokens only as much as needed instead of pre-capping every long token at `commandDisplayArgMaxLength`.

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
