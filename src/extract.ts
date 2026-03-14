import type { ExtractedCommand } from "./types.ts";

export type { ExtractedCommand };

export function extractAllCommandsFromAST(node: unknown, offset: number = 0): ExtractedCommand[] {
  if (!node || typeof node !== "object") return [];

  const n = node as Record<string, unknown>;
  const commands: ExtractedCommand[] = [];

  const type = n["type"] as string | undefined;

  switch (type) {
    // Leaf: a concrete command
    case "Command": {
      const name = n["name"] as { text?: string } | undefined;
      if (name?.text) {
        const suffix = n["suffix"] as Array<{ text?: string; value?: string; pos?: number; end?: number }> | undefined;
        const args = suffix?.map(s => s.value ?? s.text ?? "") ?? [];
        const argRanges = suffix
          ?.filter(s => s.pos != null && s.end != null)
          .map(s => ({ pos: (s.pos as number) + offset, end: (s.end as number) + offset }));
        const redirects = n["redirects"] as Array<{
          operator?: string;
          fileDescriptor?: number;
          target?: { text?: string };
          heredocQuoted?: boolean;
          content?: string;
        }> | undefined;
        const heredocs = redirects
          ?.filter(r => (r.operator === "<<" || r.operator === "<<-") && r.content != null)
          .map(r => ({
            operator: r.operator!,
            marker: r.target?.text ?? "",
            quoted: r.heredocQuoted === true,
            content: r.content!,
          }));
        const otherRedirects = redirects
          ?.filter(r => !((r.operator === "<<" || r.operator === "<<-") && r.content != null))
          .map(r => ({
            text: `${r.fileDescriptor != null ? r.fileDescriptor : ""}${r.operator ?? ""}${r.target?.text ?? ""}`,
          }));
        commands.push({
          name: name.text,
          args,
          ...(argRanges?.length === args.length ? { argRanges } : {}),
          ...(heredocs?.length ? { heredocs } : {}),
          ...(otherRedirects?.length ? { otherRedirects } : {}),
          pos: (n["pos"] as number ?? 0) + offset,
          end: (n["end"] as number ?? 0) + offset,
        });
      }
      walkArray(n["prefix"] as unknown[], commands, offset);
      walkArray(n["suffix"] as unknown[], commands, offset);
      break;
    }

    // Containers with a `commands` array
    case "Script":
    case "AndOr":
    case "Pipeline":
    case "CompoundList":
      walkArray(n["commands"] as unknown[], commands, offset);
      break;

    // Statement wrapper
    case "Statement":
      commands.push(...extractAllCommandsFromAST(n["command"], offset));
      break;

    // Subshell: (cmd1; cmd2)
    case "Subshell":
      commands.push(...extractAllCommandsFromAST(n["body"], offset));
      break;

    // Brace group: { cmd1; cmd2; }
    case "BraceGroup":
      commands.push(...extractAllCommandsFromAST(n["body"], offset));
      break;

    // Control flow
    case "If":
      commands.push(...extractAllCommandsFromAST(n["clause"], offset));
      commands.push(...extractAllCommandsFromAST(n["then"], offset));
      commands.push(...extractAllCommandsFromAST(n["else"], offset));
      break;

    case "While":
      commands.push(...extractAllCommandsFromAST(n["clause"], offset));
      commands.push(...extractAllCommandsFromAST(n["body"], offset));
      break;

    case "For":
      commands.push(...extractAllCommandsFromAST(n["body"], offset));
      break;

    case "Case":
      walkArray(n["items"] as unknown[], commands, offset);
      break;

    case "CaseItem":
      commands.push(...extractAllCommandsFromAST(n["body"], offset));
      break;

    // Function definition
    case "Function":
      commands.push(...extractAllCommandsFromAST(n["body"], offset));
      break;

    // Nested script inside $() or ``
    // Note: CommandExpansion.pos is undefined in unbash. The correct innerOffset
    // is computed in walkWordParts from the containing word's pos. This case is
    // a fallback for any path that bypasses walkWordParts — strip argRanges to
    // avoid display corruption (detection still works via cmd.args).
    case "CommandExpansion": {
      const innerCmds = extractAllCommandsFromAST(n["script"], offset);
      commands.push(...innerCmds.map(({ argRanges: _, ...cmd }) => cmd));
      break;
    }

    // Variable assignment (may contain expansions in value)
    case "Assignment":
      walkWordParts(n["value"], commands, offset);
      break;

    default:
      // Word nodes (suffix/prefix args) have no `type` but may have
      // a `parts` getter with CommandExpansions inside.
      // This getter is non-enumerable (unbash WordImpl prototype),
      // so we must access it explicitly.
      //
      // Wrapper nodes like DoubleQuoted also have a `parts` array
      // that may contain CommandExpansions. We handle both cases here.
      walkWordParts(n, commands, offset);
      break;
  }

  return commands;
}

/** Recurse into each element of an array, if it exists. */
function walkArray(arr: unknown[] | undefined, commands: ExtractedCommand[], offset: number = 0) {
  if (!Array.isArray(arr)) return;
  for (const item of arr) {
    commands.push(...extractAllCommandsFromAST(item, offset));
  }
}

/**
 * Extract commands from a word node's `parts` getter.
 * unbash's WordImpl stores `parts` as a non-enumerable prototype getter,
 * so Object.values/Object.keys won't find it — we access it directly.
 *
 * When a part is a CommandExpansion and the word has a known position,
 * we compute the correct inner offset (wordPos + offset + 2 to skip "$(")
 * and pass it into the recursive extraction. This fixes argRanges for
 * commands inside $() so raw.slice(pos, end) resolves correctly.
 * The corrections compose additively for nested substitutions.
 */
function walkWordParts(node: unknown, commands: ExtractedCommand[], offset: number = 0) {
  if (!node || typeof node !== "object") return;
  const n = node as Record<string, unknown>;
  const parts = n["parts"];
  if (!Array.isArray(parts)) return;
  const wordPos = typeof n["pos"] === "number" ? n["pos"] : undefined;

  for (const part of parts as unknown[]) {
    if (!part || typeof part !== "object") continue;
    const p = part as Record<string, unknown>;
    if (p["type"] === "CommandExpansion" && wordPos !== undefined) {
      // wordPos is the position of this word relative to the current offset context.
      // The inner script content starts 2 chars in (past "$(").
      const innerOffset = wordPos + offset + 2;
      commands.push(...extractAllCommandsFromAST(p["script"], innerOffset));
    } else {
      commands.push(...extractAllCommandsFromAST(part, offset));
    }
  }
}

/**
 * Check whether an extracted command is allowed by the allowlist.
 *
 * Matching uses subsequence logic:
 * - "git" → allows all git commands (base command match)
 * - "git status" → allows `git status`, `git status --short`, etc.
 * - "git branch --show-current" → allows `git branch --show-current`,
 *   `git branch -v --show-current`, etc.
 * - "jira issue view" → allows `jira issue view XXX-123`, etc.
 *
 * The allowlist tokens must appear in order in the actual args,
 * but extra flags or trailing positional args are permitted.
 */
export function isCommandAllowed(cmd: ExtractedCommand, allowlist: string[]): boolean {
  for (const entry of allowlist) {
    const tokens = entry.split(" ");
    const entryName = tokens[0]!;
    const entryArgs = tokens.slice(1);

    if (entryName !== cmd.name) continue;

    // Base command match with no arg requirements: allow everything
    if (entryArgs.length === 0) return true;

    // Subsequence match: entryArgs tokens must appear in order in cmd.args
    if (isSubsequence(entryArgs, cmd.args)) return true;
  }

  return false;
}

/** Check if `needle` tokens appear in order within `haystack`. */
function isSubsequence(needle: string[], haystack: string[]): boolean {
  let ni = 0;
  for (let hi = 0; hi < haystack.length && ni < needle.length; hi++) {
    if (haystack[hi] === needle[ni]) ni++;
  }
  return ni === needle.length;
}
