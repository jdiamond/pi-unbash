import type { ExtractedCommand } from "./types.ts";

export const FORMAT_COMMAND_DEFAULT_MAX_LENGTH = 120;
export const FORMAT_COMMAND_DEFAULT_ARG_MAX_LENGTH = 40;

/**
 * Format an extracted command for display.
 *
 * Re-serializes from AST tokens, preserving original quoting via argRanges.
 * The command name is always shown verbatim. Each argument token is elided
 * individually if needed:
 *   - Path-like tokens (starting with /, ~/, ./, or ../) get path-aware
 *     elision, keeping the first two path segments and the last
 *     (e.g. /Users/jdiamond/code/pi-unbash → /Users/…/pi-unbash).
 *   - Other tokens longer than argMaxLength are prefix-truncated: kept up to
 *     argMaxLength chars then "…".
 * If the total result still exceeds maxLength, it is hard-truncated with "…".
 */
export function formatCommand(
  cmd: ExtractedCommand,
  raw: string,
  options?: { maxLength?: number; argMaxLength?: number },
): string {
  const maxLength = options?.maxLength ?? FORMAT_COMMAND_DEFAULT_MAX_LENGTH;
  const argMaxLength = options?.argMaxLength ?? FORMAT_COMMAND_DEFAULT_ARG_MAX_LENGTH;

  // Build token strings: name + each arg in its original form (quoting preserved).
  const argTokens: string[] = cmd.argRanges
    ? cmd.argRanges.map(r => raw.slice(r.pos, r.end))
    : cmd.args;

  // Command name is always shown verbatim; only args are elided.
  const name = cmd.name.replace(/\n/g, "↵");
  const rawArgs = argTokens.map(t => t.replace(/\n/g, "↵"));

  // If the full command fits within maxLength, skip elision entirely.
  const rawHeredocParts = cmd.heredocs?.map(h => {
    const q = h.quoted ? "'" : "";
    return `${h.operator}${q}${h.marker}${q}↵` + h.content.replace(/\n/g, "↵") + h.marker;
  }) ?? [];
  const rawRedirectParts = cmd.otherRedirects?.map(r => r.text.replace(/\n/g, "↵")) ?? [];
  const fullDisplay = [name, ...rawArgs, ...rawRedirectParts, ...rawHeredocParts].join(" ");
  if (fullDisplay.length <= maxLength) return fullDisplay;

  const args = rawArgs.map(t => elideToken(t, argMaxLength));

  const heredocParts = cmd.heredocs?.map(h => {
    const q = h.quoted ? "'" : "";
    const prefix = `${h.operator}${q}${h.marker}${q}↵`;
    const content = h.content.replace(/\n/g, "↵");
    const full = content + h.marker;
    if (full.length <= argMaxLength) {
      return prefix + full;
    }
    return prefix + content.slice(0, argMaxLength) + "…";
  }) ?? [];

  const otherRedirectParts = cmd.otherRedirects?.map(r =>
    elideToken(r.text.replace(/\n/g, "↵"), argMaxLength)
  ) ?? [];

  let display = [name, ...args, ...otherRedirectParts, ...heredocParts].join(" ");

  // Hard-truncate if total exceeds maxLength (edge case: many args).
  if (display.length > maxLength) {
    display = display.slice(0, maxLength - 1) + "…";
  }

  return display;
}

/** Elide a single argument token if warranted. */
function elideToken(token: string, argMaxLength: number): string {
  if (isPathToken(token)) {
    const elided = elidePath(token);
    return elided.length < token.length ? elided : token;
  }
  if (token.length > argMaxLength) {
    return token.slice(0, argMaxLength) + "…";
  }
  return token;
}

/**
 * Path-like detection using character composition.
 * A token is considered path-like if:
 *   - It contains a slash (required)
 *   - It is not a URL (no ://)
 *   - After stripping surrounding quotes, the non-space characters are
 *     ≥85% path-safe ([a-zA-Z0-9/._~$@%+=,:-]) — handles bare relative
 *     paths like packages/tui/src/terminal.ts and quoted paths with $
 *     like "$PROJECT_ROOT/src/routes/$page.tsx"
 *   - Spaces don't exceed 10% of the inner length (guards against sentences
 *     that happen to contain a slash)
 */
function isPathToken(token: string): boolean {
  if (!token.includes("/")) return false;
  if (token.includes("://")) return false;
  const inner = token.replace(/^["']|["']$/g, "");
  const spaces = (inner.match(/ /g) ?? []).length;
  if (spaces / inner.length > 0.1) return false;
  const nonSpace = inner.replace(/ /g, "");
  if (nonSpace.length === 0) return false;
  const safe = (nonSpace.match(/[a-zA-Z0-9/._~$@%+=,:-]/g) ?? []).length;
  return safe / nonSpace.length >= 0.85;
}

/**
 * Path-aware elision: keep the first two segments and the last.
 * /Users/jdiamond/code/pi-unbash → /Users/…/pi-unbash
 */
function elidePath(p: string): string {
  const parts = p.split("/");
  if (parts.length <= 3) return p;
  return parts.slice(0, 2).join("/") + "/…/" + parts[parts.length - 1];
}
