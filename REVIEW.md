# Code Review: pi-unbash

*Reviewed: March 10, 2026*

## ✅ What's Good

1. **Core concept is solid** — AST-based command extraction is genuinely better than regex matching. The README's `FOO=bar echo $(git status && \`rm -rf /\`)` example is a real threat that this handles.
2. **Clean extension structure** — Proper use of `pi.on("tool_call")`, `isToolCallEventType`, `ctx.ui.confirm`, `registerCommand`. All idiomatic pi extension patterns.
3. **Good test coverage** — Tests cover pipes, `&&`, `$()` subshells, backticks, and nested evil commands.
4. **Config persistence** — Reading/writing to `settings.json` under a namespace key is clean.

## 🟡 Issues & Suggestions

### 1. AST traversal misses node types (Medium — Security)

`extractAllCommandsFromAST` only handles `Command`, `Script`, `AndOr`, `Pipeline`, and `Statement`. It doesn't handle:
- **Subshells** (`(cmd1; cmd2)`) — a `Subshell` node type
- **If/While/For/Case** — control flow structures
- **Function definitions** — `foo() { rm -rf /; }`
- **Here-docs with command expansions**

Consider a more generic recursive walk that descends into *all* child properties, rather than only known node types. Or at minimum, audit `unbash`'s full AST node type list and add the missing ones.

### 2. No handling of bare assignments with subshells (Medium — Security)

`FOO=$(rm -rf /)` with no command name — just an assignment — won't have `astNode.type === "Command"` with a `name.text`. The prefix-handling code only runs when there's already a command name. Test this case.

### 3. Config is read once at load, but `loadConfig` isn't called on each `tool_call` (Low)

If another process or extension modifies `settings.json` externally, the in-memory `config` goes stale. Probably fine in practice since the `/unbash` command updates both the file and the in-memory object.

### 4. Direct `settings.json` manipulation is fragile (Medium — Correctness)

Raw `fs.readFileSync` / `fs.writeFileSync` on `~/.pi/agent/settings.json` is a shared file — other pi processes or extensions could write to it concurrently, causing race conditions or data loss. There's no file locking. The pi docs don't provide a settings API, so this may be the only option, but it's worth noting as a caveat.

### 5. `/unbash` command lacks a `list` subcommand (Low — UX)

Users can't see the current allowlist without opening `settings.json`. Add `/unbash list` to show the current config (enabled status + allowed commands).

### 6. Parse failures block unconditionally (Low — UX)

If `unbash` can't parse a command (e.g., bash-isms it doesn't support), execution is blocked with no way for the user to override. Consider falling back to a confirmation dialog instead of a hard block:

```typescript
// Instead of:
return { block: true, reason: `Failed to parse bash AST...` };
// Consider:
const confirmed = await ctx.ui.confirm("Parse Error", `Could not parse: ${rawCmd}\n\nAllow anyway?`);
if (!confirmed) return { block: true, reason: "User denied unparseable command." };
```

This also needs the `ctx.hasUI` check before trying `confirm`.

### 7. Missing `CommandExpansion` in suffix parts recursion (Low — Robustness)

In suffix handling, `suffixNode.parts` is checked, but a suffix node might itself be a `CommandExpansion` directly (not wrapped in parts). Worth verifying against `unbash`'s actual AST output for edge cases like `cmd $(nested)`.

### 8. No `devDependencies` for types (Nit)

`@mariozechner/pi-coding-agent` types are imported but not listed in `devDependencies`. It's in `peerDependencies` which is correct for runtime, but for `tsc --noEmit` to work during development it needs to be resolvable. Works now presumably because it's globally installed, but will break in CI.

## 🔴 One Real Bug

The `tool_call` handler returns `undefined` (falls through) when `allCommands.length === 0`. This means commands that parse successfully but extract zero commands (e.g., pure variable assignments like `FOO=bar`) silently pass without any check. This ties into issue #2 — a standalone `FOO=$(rm -rf /)` would extract 0 commands from the top-level walk and be auto-approved.

## Addressed

### v1.1.0

- **Issues 1, 2 (AST traversal gaps + bare assignments)**: Rewrote `extractAllCommandsFromAST` with explicit `switch` on all unbash node types: `Subshell`, `BraceGroup`, `If`, `While`, `For`, `Case`/`CaseItem`, `Function`, `Assignment`, and word nodes. A generic `Object.values` walk was attempted first but failed because unbash's `WordImpl` stores `parts` and `value` as non-enumerable prototype getters — `Object.values()` silently skips them. Added 7 new tests covering subshells, if/else, while, for, case, function definitions, and bare assignments with subshells.
- **Bug (zero-command passthrough)**: Now caught by the bare assignment handling — `FOO=$(rm -rf /)` correctly extracts `rm`.

### Still Open

- Issue 3 (config staleness) — low priority, works fine in practice
- Issue 4 (settings.json race conditions) — no pi API available, documented as caveat
- Issue 5 (`/unbash list` subcommand) — UX improvement, not yet added
- Issue 6 (parse failure hard block) — should fall back to confirmation dialog
- Issue 7 (suffix CommandExpansion) — resolved by explicit `parts` access
- Issue 8 (missing devDependencies) — not yet added

## Summary

The architecture is right and the pi integration is clean. The main concern was **completeness of the AST traversal** — resolved in v1.1.0 with explicit node type handling and direct `parts` getter access to work around unbash's non-enumerable prototype properties.
