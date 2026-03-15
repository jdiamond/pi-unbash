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

Settings are persisted globally in `~/.pi/agent/settings.json` under the `"unbash"` key:

```json
{
  "packages": [
    "npm:pi-unbash"
  ],
  "unbash": {
    "enabled": true,
    "alwaysAllowed": [
      "ls",
      "pwd",
      "cd",
      "cat",
      "echo",
      "grep",
      "find",
      "git"
    ]
  }
}
```

### Allowlist

The `alwaysAllowed` setting controls which commands pass silently. You can allow a base command (all subcommands), or a specific subcommand (only matching invocations):

```json
{
  "unbash": {
    "alwaysAllowed": [
      "ls", "pwd", "cd", "cat", "echo", "grep", "find",
      "git status",
      "git log",
      "git diff",
      "jira issue view",
      "git branch --show-current"
    ]
  }
}
```

Matching uses **subsequence logic** — the tokens in your allowlist entry must appear in order in the actual command, but extra flags and trailing arguments are permitted:

| Allowlist Entry | Matches | Doesn't Match |
|----------------|---------|---------------|
| `git` | all git commands | — |
| `git status` | `git status`, `git status --short` | `git commit -m "msg"` |
| `git branch --show-current` | `git branch --show-current`, `git branch -v --show-current` | `git branch -D main` |
| `jira issue view` | `jira issue view PROJ-123`, `jira issue view --verbose PROJ-123` | `jira issue create` |

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

* `/unbash allow <command>` - Permanently allow a command (e.g., `/unbash allow git` or `/unbash allow git status`)
* `/unbash deny <command>` - Remove a command from the allowed list (e.g., `/unbash deny git status`)
* `/unbash toggle` - Turn the entire confirmation system on or off
* `/unbash list` - Show current status, allowed commands, and session-allowed commands

## License

MIT
