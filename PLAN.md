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
**Files:** `src/extract.ts:168-192`, `src/extract.ts:261-279`

`collectWordPart()` ignores `ArithmeticExpansion`, and `collectArithmeticExpression()` ignores `ArithmeticWord`.

Repro:

```bash
echo $(( $(rm -rf /) + 1 ))
(( $(rm -rf /) + 1 ))
```

Current extraction only sees `echo` in the first case, and likely nothing dangerous in the second.

**Why it matters:** this is a real security blind spot.

**Suggested fix:** when you see an `ArithmeticExpansion` / `ArithmeticWord`, scan for `$(` / backticks and extract nested commands, or conservatively mark arithmetic containing command-substitution syntax as requiring approval.

Add tests for both forms.

---

### 3. Unquoted heredoc bodies can execute command substitutions, but they’re not inspected
**File:** `src/extract.ts:151-157`

`collectRedirect()` visits `redirect.body`, but `unbash` doesn’t seem to expose parsed parts for heredoc bodies, so this misses cases like:

```bash
cat <<EOF
$(rm -rf /)
EOF
```

Your extractor currently only sees `cat`.

**Why it matters:** another security gap.

**Suggested fix:** for unquoted heredocs (`heredocQuoted !== true`), conservatively scan `redirect.content` for command substitution syntax. Even a safe fallback of “if unquoted heredoc contains `$(` or backticks, require confirmation” would be better than silently allowing it.

Also add a paired test proving quoted heredocs do **not** trigger extraction:

```bash
cat <<'EOF'
$(rm -rf /)
EOF
```

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
2. Close arithmetic substitution gap
3. Close unquoted heredoc gap
4. Add tests for those three immediately

## Nice simplifications

- Extract config normalization into a single helper used by load/save/commands
- Normalize allowlist entries once instead of ad hoc
- Consider a small helper for repeated display formatting options in `src/index.ts`
