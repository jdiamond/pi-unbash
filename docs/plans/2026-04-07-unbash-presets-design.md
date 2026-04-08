# Unbash Presets Design

Date: 2026-04-07
Status: Approved during brainstorming

## Summary

Add first-class preset support to `pi-unbash` so users can apply ordered policy bundles instead of maintaining large deny lists manually.

This design introduces two built-in presets:

1. `destructive-calls`
2. `pi-bash-restrict`

It also adds config-defined custom presets, ordered preset application, and `/unbash preset ...` commands for managing the active global preset list.

The core design choice is to treat presets as **unified policy bundles**, not only command-rule bundles. A preset may contribute:

- command `rules`
- top-level `toolPolicies`
- shell/AST `guards`

All preset decisions use **last-match-wins ordering**.

## Goals

- Ship built-in `destructive-calls` and `pi-bash-restrict` presets.
- Allow users to activate multiple presets in an ordered list.
- Allow custom presets in config with the same expressive power as built-ins.
- Preserve the existing explicit rule system and session approvals.
- Keep AST-based shell inspection available, but only for unresolved cases.

## Non-goals

- Replace the existing explicit `rules` config.
- Remove current session-based allow behavior.
- Perfectly clone the upstream `pi-restrict-bash` implementation line-for-line.
- Introduce project-session preset mutation commands.

## Config shape

Extend `unbash` config with:

```json
{
  "unbash": {
    "enabled": true,
    "presets": ["destructive-calls", "pi-bash-restrict"],
    "customPresets": {
      "my-team-safe-mode": {
        "toolPolicies": {
          "grep": "deny"
        },
        "guards": {
          "redirects": "deny"
        },
        "rules": {
          "docker": "ask",
          "docker compose up": "deny"
        }
      }
    },
    "rules": {
      "git": "allow",
      "git push": "deny"
    },
    "commandDisplayMaxLength": 120,
    "commandDisplayArgMaxLength": 40
  }
}
```

### New fields

- `presets: string[]`
  - Ordered applied preset names.
  - Global and project lists are concatenated in order: global first, then project.
- `customPresets: Record<string, UnbashPreset>`
  - User-defined preset definitions.
  - Same policy shape as built-ins.
  - Global and project maps merge by preset name, with project overriding same-name definitions.

### Preset type

```ts
type PolicyAction = "allow" | "deny";

type UnbashPreset = {
  rules?: Record<string, "allow" | "ask" | "deny">;
  toolPolicies?: Record<string, PolicyAction>;
  guards?: Record<string, PolicyAction>;
};
```

Notes:

- `rules` keep the existing command-pattern semantics.
- `toolPolicies` apply to top-level Pi tool calls such as `grep`, `find`, and `ls`.
- `guards` apply to named shell/AST restrictions such as command substitution or redirects.

## Built-in presets

### `destructive-calls`

This preset is primarily a `rules` bundle containing hard denies for obviously destructive commands, including the approved list from brainstorming such as:

- `rm -rf /`
- `rm -rf /*`
- `rm -rf .`
- `rm -rf ~`
- `rm -rf ~/*`
- `rm -rf $HOME`
- `rm -r /`
- `rm -r /*`
- `rm -r ~`
- `rm -r ~/*`
- `mkfs`
- `mkfs.ext4`
- `mkfs.ext3`
- `mkfs.vfat`
- `mkfs.ntfs`
- `dd if=/dev/zero of=/dev`
- `dd of=/dev`
- `shutdown`
- `reboot`
- `halt`
- `poweroff`
- `init 0`
- `init 6`
- `:(){ :|: & };:`
- `:() { :|:& };:`
- `chmod -R 777 /`
- `chmod -R 000 /`
- `chown -R`
- `powershell Remove-Item -Recurse -Force`
- `Format-Volume`
- `format.com`

### `pi-bash-restrict`

This preset is a mixed policy bundle that approximates the upstream extension using `pi-unbash` internals.

It should include:

- `toolPolicies`
  - `grep: deny`
  - `find: deny`
  - `ls: deny`
- `rules` for command-level restrictions such as:
  - `sudo`
  - nested shells like `bash`, `sh`, `zsh`
  - `cat`, `tee`, `xargs`, `nl`
  - `fd`, `find`, `grep`, `ls`, `tree`
  - wrapper commands like `eval`, `exec`, `nohup`, `timeout`, `time`, `watch`, `stdbuf`
  - command runners and scaffolding launchers like `npx`, `uvx`, `bunx`, `pnpx`, `pnpm dlx`, `yarn dlx`, `npm exec`, `bun x`, `uv tool run`, `npm create`, `npm init`, `yarn create`, `pnpm create`, `bun create`
  - mutating `git` subcommands and `git grep`
  - `sed -i` and `sed --in-place`
- `guards` for unresolved-shell escalation, such as:
  - `command-substitution`
  - `process-substitution`
  - `variable-expansion`
  - `redirects`
  - `subshells`
  - `background-execution`
  - `control-flow`
  - `function-definition`

## Effective policy model

Presets are applied in list order, with **last match winning**.

Effective command-rule precedence should remain intuitive:

1. built-in default allow rules
2. policies from active global presets
3. explicit global `rules`
4. policies from active project presets
5. explicit project `rules`
6. session rules

Important behavior decisions:

- Presets provide baseline policy.
- Explicit `rules` remain the sharp override tool.
- Session approvals only produce command-rule `allow` entries; they do not mutate presets, tools, or guards.

For `toolPolicies` and `guards`, ordering should also be last-match-wins across applied preset order. This keeps the model consistent across rule types.

## Runtime evaluation flow

Evaluation is intentionally short-circuited.

### 1. Tool policy phase

Check effective `toolPolicies` first.

- If tool is explicitly `deny` -> block immediately.
- If tool is explicitly `allow` -> allow immediately.
- Otherwise continue.

### 2. Fast command-rule phase

If the tool is `bash`, run a lightweight top-level command classification pass.

- If command rules resolve to `deny` -> block immediately.
- If command rules resolve to `allow` -> allow immediately.
- Otherwise continue.

This phase is deliberately cheap and should avoid full AST work.

### 3. AST guard phase

This phase runs only for unresolved, skipped, or unclear cases; in practice that means the command is still effectively `ask` after earlier phases.

- Parse the shell with `unbash`.
- Detect guarded constructs by AST/node inspection.
- If a matched guard resolves to `deny` -> block immediately.
- Otherwise the command remains `ask` and follows the normal approval UI.

This means AST parsing is never performed for commands already explicitly allowed or denied.

## `/unbash` command UX

Add a preset management subcommand family:

- `/unbash preset list`
- `/unbash preset add <name>`
- `/unbash preset remove <name>`
- `/unbash preset clear`

Behavior:

- Commands mutate the global `~/.pi/agent/settings.json` active preset list.
- `add` appends to the ordered list.
- `remove` removes all matching occurrences of a preset name.
- `clear` empties the active preset list.
- `list` shows:
  - built-in preset names
  - available custom preset names
  - active preset order
  - current explicit rule layers
  - warnings for unknown applied preset names

## Validation and failure handling

Validation should mirror the project’s current safe-fallback approach.

- Invalid top-level shapes should fall back safely and warn.
- Invalid preset names should not crash loading.
- Unknown preset names should be ignored at runtime but surfaced in warnings and `/unbash preset list`.
- Malformed `customPresets` entries should keep valid subfields and drop invalid ones.
- Invalid `toolPolicies` or `guards` entries should be ignored with warnings.
- Validation must never make config more permissive than intended.

## Testing plan

Add coverage for:

1. config parsing and validation
   - valid/invalid `presets`
   - valid/invalid `customPresets`
   - safe fallback behavior
2. merge behavior
   - global + project preset concatenation
   - custom preset override by name
   - explicit `rules` overriding preset-provided rules
3. policy resolution
   - last-match-wins for rules, tools, and guards
   - tool policy short-circuiting
   - command-rule short-circuiting
   - AST guard escalation only for unresolved/ask cases
4. built-in presets
   - `destructive-calls` sample denies
   - `pi-bash-restrict` blocks intended tools and patterns
5. command UX
   - `/unbash preset add|remove|clear|list`
   - persisted preset ordering
   - unknown preset warnings

## Recommended implementation slices

1. Introduce preset types, config parsing, and validation.
2. Add built-in preset registry.
3. Build effective preset resolution for rules, tools, and guards.
4. Add tool-policy evaluation.
5. Add fast command-rule precheck.
6. Add AST guard detector framework and built-in guard set.
7. Add `/unbash preset ...` commands.
8. Add README/docs updates after implementation.

## Final decisions captured

- Config uses both `presets` and `customPresets`.
- Global/project `presets` concatenate in order.
- `/unbash` uses `preset list|add|remove|clear` UX.
- Presets may include `rules`, `toolPolicies`, and `guards`.
- Custom presets are as expressive as built-ins.
- Last-match-wins applies to rules, tools, and guards.
- Tool phase runs first.
- Fast command-rule phase runs before AST.
- AST guard phase runs only for unresolved/ask/unclear cases.
