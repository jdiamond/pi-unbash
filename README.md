# pi-unbash 🛡️

A high-security, AST-powered bash confirmation extension for the [`pi`](https://github.com/badlogic/pi-mono) coding agent.

## Why `pi-unbash`?

Most bash confirmation extensions rely on simple string matching, regular expressions, or custom lexers to determine what commands an AI is trying to run. Those approaches can work for many cases, but they tend to get brittle once shell syntax becomes deeply nested or heavily composed. If an AI generates a command like:

```bash
FOO=bar echo "$(git status && `rm -rf /`)"
```

it is not enough to notice that the raw string contains suspicious text somewhere. The harder problem is to **comprehensively extract the embedded commands that will actually execute**, even when they are buried inside substitutions, pipelines, redirects, or control-flow syntax.

**`pi-unbash` is different.** It uses [`unbash`](https://github.com/webpro-nl/unbash), a fast, zero-dependency TypeScript parser that generates a full POSIX-compliant Abstract Syntax Tree (AST). `pi-unbash` recursively traverses that tree to extract embedded commands no matter how complicated the full shell command becomes—across pipes (`|`), logic gates (`&&`, `||`), subshells (`$()`, `` `...` ``), heredocs, and more.

That same AST also makes the approval prompt easier to read: instead of showing only the raw LLM-generated shell string, `pi-unbash` can format the extracted commands into a clearer, more compact preview that is easier to approve or reject in the terminal UI.

If the AI tries to sneak an unapproved command past you, `pi-unbash` will catch it and block execution until you explicitly confirm it via the terminal UI.

## Installation

You can install `pi-unbash` globally into your pi settings:

```bash
# Install globally
pi install npm:pi-unbash

# Or install locally for testing
pi -e ./path/to/pi-unbash
```

## Usage

By default, `pi-unbash` allows a set of safe, read-only commands to execute silently. See [`src/defaults.ts`](src/defaults.ts) for the full list.

If the AI attempts to run anything else (e.g., `git commit`, `npm`, `rm`, `node`), the execution is paused, and a confirmation dialog appears in your `pi` session:

```text
⚠️ Unapproved Commands

✔ cd /Users/…/project
✖ npm test
✖ git commit -A -m "update files"

 → Allow
   Always allow npm, git (this session)
   Reject
```

**Allow** runs the command once. **Always allow X (this session)** adds the base command(s) to an in-memory allowlist for the rest of the session — no prompts for that command again until you reload. **Reject** blocks execution.

## Configuration

Settings can be configured at two levels:

1. **Global:** `~/.pi/agent/settings.json` — applies to all projects
2. **Project:** `<project>/.pi/settings.json` — applies only to that project

Project settings override global settings. Rules merge in order: defaults → global rules → project rules → session rules. Last match wins.

### Global Settings

Settings are persisted globally in `~/.pi/agent/settings.json` under the `"unbash"` key:

```json
{
  "packages": [
    "npm:pi-unbash"
  ],
  "unbash": {
    "enabled": true,
    "rules": {
      "npm test": "allow"
    }
  }
}
```

### Project Settings

Project-level settings go in `.pi/settings.json` in your project root:

```json
{
  "unbash": {
    "rules": {
      "npm run build": "allow",
      "npm run test": "allow"
    }
  }
}
```

Project settings override global settings and can be committed to version control to share with your team.

### Rules

The `rules` object maps command patterns to actions. Only your personal overrides go here — the built-in defaults (see [`src/defaults.ts`](src/defaults.ts)) are always applied first and never written to disk, so you automatically benefit from future default updates.

Rules are evaluated in order: built-in defaults first, then your `rules` entries, **last match wins**. This means entries later in your `rules` object override earlier ones and override any matching default.

Actions:
- `"allow"` — run silently without prompting
- `"ask"` — prompt for approval (the default for anything unmatched)
- `"deny"` — hard-block immediately with no approval UI override

The special pattern `"*"` matches any command:
- `"*": "allow"` — trust all commands globally (opt out of pi-unbash)
- `"*": "deny"` — block all commands (maximum lock-down)

Matching uses **subsequence logic** — the tokens in your rule must appear in order in the actual command, but extra flags and arguments anywhere in the sequence are permitted:

| Rule | Matches | Doesn't Match |
|------|---------|---------------|
| `"git"` | all git commands | — |
| `"git status"` | `git status`, `git status --short` | `git commit -m "msg"` |
| `"git branch --show-current"` | `git branch --show-current`, `git branch -v --show-current` | `git branch -D main` |
| `"jira issue view"` | `jira issue view PROJ-123`, `jira issue view --verbose PROJ-123` | `jira issue create` |
| `"terraform apply --dry-run"` | `terraform apply --dry-run`, `terraform apply -v --dry-run` | `terraform apply`, `terraform apply --force` |

Because last-match-wins, you can override a broad rule with a narrower deny rule:

```json
{
  "unbash": {
    "rules": {
      "git": "allow",
      "git push": "deny"
    }
  }
}
```

Here `git push` is hard-blocked even though `git` matches first — the later `git push` entry wins.

### Display Settings

The confirmation prompt elides long command arguments to keep the display readable:

- **The command name** is always shown in full.
- If the full command fits within `commandDisplayMaxLength`, it is shown unchanged.
- Otherwise, the formatter shrinks later tokens only as much as needed to fit the total budget.
- **Path arguments** (starting with `/`, `~/`, `./`, or `../`) get path-aware middle elision that preserves the tail.
- **Other long arguments** are prefix-truncated with `…` only when needed.
- `commandDisplayArgMaxLength` acts as the minimum per-token elision target, not a hard cap when there is still room in the overall display budget.
- If the total display still exceeds `commandDisplayMaxLength`, the whole string is hard-truncated.

```json
{
  "unbash": {
    "commandDisplayMaxLength": 120,
    "commandDisplayArgMaxLength": 40
  }
}
```

- **`commandDisplayMaxLength`** — total character budget for the display string (default: `120`).
- **`commandDisplayArgMaxLength`** — minimum per-token elision target when shrinking long arguments/heredocs to fit the overall display budget (default: `40`).

### Commands

You can manage settings dynamically mid-session using the `/unbash` command:

* `/unbash allow <command>` - Persist a global allow rule (e.g., `/unbash allow git`)
* `/unbash deny <command>` - Persist a global deny rule (e.g., `/unbash deny git push`)
* `/unbash toggle` - Turn the entire confirmation system on or off
* `/unbash list` - Show current status, default rules, user rules (global), project rules, and session rules

When updating an existing allow/deny rule via `/unbash`, that rule is moved to the end of the rule map so the newest change wins under last-match-wins ordering.

## License

MIT
