/** A command extracted from the AST with its name and arguments. */
export interface ExtractedCommand {
  name: string;
  args: string[];
}

export function extractAllCommandsFromAST(node: unknown): ExtractedCommand[] {
  if (!node || typeof node !== "object") return [];

  const n = node as Record<string, unknown>;
  const commands: ExtractedCommand[] = [];

  const type = n["type"] as string | undefined;

  switch (type) {
    // Leaf: a concrete command
    case "Command": {
      const name = n["name"] as { text?: string } | undefined;
      if (name?.text) {
        const suffix = n["suffix"] as Array<{ text?: string; value?: string }> | undefined;
        const args = suffix?.map(s => s.value ?? s.text ?? "") ?? [];
        commands.push({ name: name.text, args });
      }
      walkArray(n["prefix"] as unknown[], commands);
      walkArray(n["suffix"] as unknown[], commands);
      break;
    }

    // Containers with a `commands` array
    case "Script":
    case "AndOr":
    case "Pipeline":
    case "CompoundList":
      walkArray(n["commands"] as unknown[], commands);
      break;

    // Statement wrapper
    case "Statement":
      commands.push(...extractAllCommandsFromAST(n["command"]));
      break;

    // Subshell: (cmd1; cmd2)
    case "Subshell":
      commands.push(...extractAllCommandsFromAST(n["body"]));
      break;

    // Brace group: { cmd1; cmd2; }
    case "BraceGroup":
      commands.push(...extractAllCommandsFromAST(n["body"]));
      break;

    // Control flow
    case "If":
      commands.push(...extractAllCommandsFromAST(n["clause"]));
      commands.push(...extractAllCommandsFromAST(n["then"]));
      commands.push(...extractAllCommandsFromAST(n["else"]));
      break;

    case "While":
      commands.push(...extractAllCommandsFromAST(n["clause"]));
      commands.push(...extractAllCommandsFromAST(n["body"]));
      break;

    case "For":
      commands.push(...extractAllCommandsFromAST(n["body"]));
      break;

    case "Case":
      walkArray(n["items"] as unknown[], commands);
      break;

    case "CaseItem":
      commands.push(...extractAllCommandsFromAST(n["body"]));
      break;

    // Function definition
    case "Function":
      commands.push(...extractAllCommandsFromAST(n["body"]));
      break;

    // Nested script inside $() or ``
    case "CommandExpansion":
      commands.push(...extractAllCommandsFromAST(n["script"]));
      break;

    // Variable assignment (may contain expansions in value)
    case "Assignment":
      walkWordParts(n["value"], commands);
      break;

    default:
      // Word nodes (suffix/prefix args) have no `type` but may have
      // a `parts` getter with CommandExpansions inside.
      // This getter is non-enumerable (unbash WordImpl prototype),
      // so we must access it explicitly.
      //
      // Wrapper nodes like DoubleQuoted also have a `parts` array
      // that may contain CommandExpansions. We handle both cases here.
      walkWordParts(n, commands);
      break;
  }

  return commands;
}

/** Recurse into each element of an array, if it exists. */
function walkArray(arr: unknown[] | undefined, commands: ExtractedCommand[]) {
  if (!Array.isArray(arr)) return;
  for (const item of arr) {
    commands.push(...extractAllCommandsFromAST(item));
  }
}

/**
 * Extract commands from a word node's `parts` getter.
 * unbash's WordImpl stores `parts` as a non-enumerable prototype getter,
 * so Object.values/Object.keys won't find it — we access it directly.
 */
function walkWordParts(node: unknown, commands: ExtractedCommand[]) {
  if (!node || typeof node !== "object") return;
  const parts = (node as Record<string, unknown>)["parts"];
  walkArray(parts as unknown[], commands);
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

/** Format an extracted command for display (name + first arg). */
export function formatCommand(cmd: ExtractedCommand): string {
  return cmd.args.length > 0 ? `${cmd.name} ${cmd.args[0]}` : cmd.name;
}
