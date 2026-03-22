# Plan

I reviewed `src/*`, `README.md`, and the tests, and ran `npm test` — everything passes as-is.

## Biggest opportunities

### 1. Falsey `"unbash"` config skips validation and falls back to permissive defaults
**File:** `src/index.ts:105`

```ts
if (parsed.unbash) {
  return validateLoadedUnbashConfig(parsed.unbash);
}
```

If `settings.json` contains:

```json
{ "unbash": null }
```

or `false`, `0`, `""`, etc., this branch is skipped and `loadConfig()` returns `DEFAULT_CONFIG`, not the safe fallback.

**Why it matters:** an invalid config silently becomes more permissive than intended.

**Fix:** check for key presence, not truthiness, e.g. `Object.hasOwn(parsed, "unbash")`.

---

### 2. Command substitutions inside arithmetic are currently missed
**Status:** ✅ fixed.

This appeared to be an upstream `unbash` limitation. Upstream issue:

- `webpro-nl/unbash#1` — _Command substitutions inside arithmetic are not represented structurally in the AST_

**What we did:**
- Updated unbash dependency to `jdiamond/unbash#arith-cmd-subst` (fork with the fix)
- Added `ArithmeticExpansion` case in `collectWordPart()` to traverse into arithmetic expressions
- Added `ArithmeticCommandExpansion` case in `collectArithmeticExpression()` to extract embedded commands
- Handled both `script` (unquoted arithmetic) and `inner` (double-quoted arithmetic) paths
- Added `collectArithmeticCommands()` for arithmetic contexts where commands ARE executed (unlike heredoc plain text)
- Fixed source string handling so `formatCommand()` displays commands correctly
- Added tests for extraction and formatting

**Follow-up:** Once upstream PR is merged, switch from fork back to npm release and update dependency.

---

### 3. Unquoted heredoc bodies can execute command substitutions, but they’re not inspected
**Status:** fixed locally for now; likely should also be addressed upstream in `unbash`.

`collectRedirect()` visited `redirect.body`, but the installed `unbash` build did not expose heredoc body parts, so unquoted heredocs like this were missed:

```bash
cat <<EOF
$(rm -rf /)
EOF
```

The current local fix parses unquoted `redirect.content` as shell text and inspects only embedded expansions inside words, without treating the heredoc body itself as executable commands.

Added test coverage for:
- unquoted heredoc with `$(...)`
- unquoted heredoc with backticks
- quoted heredoc remaining inert
- plain heredoc text not being treated as commands

**Reminder:** create a follow-up issue in `webpro-nl/unbash` about unquoted heredoc body expansions not being surfaced structurally/consumably. If that is fixed upstream, simplify or remove most of the local workaround in `pi-unbash`.

---

### 4. Allowlist matching/tokenization is brittle
**File:** `src/extract.ts:311`

```ts
const tokens = entry.split(" ");
```

That breaks on internal repeated whitespace. Example:

- `"git status"` matches
- `"git   status"` does not

`/unbash allow ...` normalizes user input, but hand-edited config can still fail unexpectedly.

**Fix:** normalize entries once and tokenize with `/\s+/`. Ideally canonicalize on:
- config load
- `/unbash allow`
- `/unbash deny`

This would also simplify reasoning across the code.

---

### 5. The extractor is conservative in ways that may create false positives
**Files:** `src/extract.ts` around `Function`, `If`, `Case`

Example:

```bash
danger(){ rm -rf /; }; echo ok
```

The extractor finds `rm` even though defining a function does not execute it.

Same general issue for all `if`/`case` branches: it treats “possibly executable” as “executed”.

**This may be intentional**, but if so:
- document it explicitly as conservative static analysis
- tone down README claims like “extract every single base command being executed”

Right now the docs overstate precision.

---

### 6. `saveConfig()` doesn’t recover well from malformed `settings.json`
**File:** `src/index.ts:118-131`

If `settings.json` is invalid JSON:
- `loadConfig()` falls back safely
- but `saveConfig()` will fail to parse the file and just `console.error(...)`

That means `/unbash allow`, `/unbash deny`, `/unbash toggle` can appear to work in-session but fail to persist.

**Better behavior:** either
- notify via UI that persistence failed, or
- rewrite a minimal safe settings file after explicit warning

## What to tackle first

1. Fix falsey config handling in `loadConfig()`
2. ~~Close arithmetic substitution gap~~ ✅ done
3. ~~Close unquoted heredoc gap~~ (already fixed)
4. Add tests for config handling

## Nice simplifications

- Extract config normalization into a single helper used by load/save/commands
- Normalize allowlist entries once instead of ad hoc
- Consider a small helper for repeated display formatting options in `src/index.ts`
