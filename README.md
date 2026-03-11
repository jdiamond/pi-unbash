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

By default, `pi-unbash` allows harmless read-only commands to execute silently:
`ls`, `pwd`, `cat`, `echo`, `grep`, `find`.

If the AI attempts to run anything else (e.g., `git`, `npm`, `rm`, `node`), the execution is paused, and a confirmation dialog appears in your `pi` session:

```text
Security: Unauthorized Command Detected

The agent wants to execute:
git commit -m "update files" && npm run build

Unapproved Base Commands found: git, npm

Allow this execution?
→ Yes
  No
```

## Configuration & Commands

You can manage your security settings dynamically mid-session using the `/unbash` interactive command:

* `/unbash allow <command>` - Permanently allow a base command (e.g., `/unbash allow git`)
* `/unbash deny <command>` - Remove a command from the allowed list
* `/unbash toggle` - Turn the entire confirmation system on or off

Your settings are persisted globally in `~/.pi/agent/extensions/pi-unbash.json`.

## License

MIT
