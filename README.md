# pi-unbash 🛡️

A high-security, AST-powered bash confirmation extension for the [`pi`](https://github.com/badlogic/pi-mono) coding agent.

## Why `pi-unbash`?

Most bash confirmation extensions rely on simple string matching, regular expressions, or custom lexers to determine what commands an AI is trying to run. This is dangerous. If an AI generates a complex command like:

```bash
FOO=bar echo $(git status && `rm -rf /`)
```

A regex-based checker will likely fail to detect the nested `rm` command hiding inside the subshell and backticks. 

**`pi-unbash` is different.** It uses [`unbash`](https://github.com/webpro/unbash), a fast, zero-dependency TypeScript parser that generates a full POSIX-compliant Abstract Syntax Tree (AST). `pi-unbash` recursively traverses this tree to extract *every single base command* being executed—no matter how deeply nested in pipes (`|`), logic gates (`&&`, `||`), or subshells (`$()`, ` `` `).

If the AI tries to sneak an unapproved command past you, `pi-unbash` will catch it and block execution until you explicitly confirm it via the terminal UI.

## Installation

You can install `pi-unbash` globally into your pi settings:

```bash
# Install from npm (once published)
pi install npm:pi-unbash

# Or install locally for testing
pi -e ./path/to/pi-unbash
```

## Usage

By default, `pi-unbash` allows a set of safe, read-only commands to execute silently. See [`src/defaults.ts`](src/defaults.ts) for the full list.

If the AI attempts to run anything else (e.g., `git commit`, `npm`, `rm`, `node`), the execution is paused, and a confirmation dialog appears in your `pi` session:

```text
⚠️ Unapproved Commands

 - npm test
 - git commit -A -m "update files"

 → Allow
   Always allow npm, git (this session)
   Reject
```

**Allow** runs the command once. **Always allow X (this session)** adds the base command(s) to an in-memory allowlist for the rest of the session — no prompts for that command again until you reload. **Reject** blocks execution.

### Subcommand Control

You can allow specific subcommands without allowing the entire base command. For example, you might want `git status` and `git log` to pass silently, but still be prompted for `git commit` or `git push`:

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

## Configuration & Commands

You can manage your security settings dynamically mid-session using the `/unbash` interactive command:

* `/unbash allow <command>` - Permanently allow a command (e.g., `/unbash allow git` or `/unbash allow git status`)
* `/unbash deny <command>` - Remove a command from the allowed list (e.g., `/unbash deny git status`)
* `/unbash toggle` - Turn the entire confirmation system on or off
* `/unbash list` - Show current status and allowed commands

Your settings are persisted globally inside pi's central `~/.pi/agent/settings.json` file under the `"unbash"` key:

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

## License

MIT
