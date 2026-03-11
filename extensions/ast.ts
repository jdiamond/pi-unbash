export function extractAllCommandsFromAST(node: unknown): string[] {
  if (!node || typeof node !== "object") return [];

  const n = node as Record<string, unknown>;
  const commands: string[] = [];

  const type = n["type"] as string | undefined;

  switch (type) {
    // Leaf: a concrete command
    case "Command": {
      const name = n["name"] as { text?: string } | undefined;
      if (name?.text) commands.push(name.text);
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
      if (type === undefined) {
        walkWordParts(n, commands);
      }
      break;
  }

  return commands;
}

/** Recurse into each element of an array, if it exists. */
function walkArray(arr: unknown[] | undefined, commands: string[]) {
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
function walkWordParts(node: unknown, commands: string[]) {
  if (!node || typeof node !== "object") return;
  const parts = (node as Record<string, unknown>)["parts"];
  walkArray(parts as unknown[], commands);
}
