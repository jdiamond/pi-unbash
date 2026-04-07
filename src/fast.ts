export interface FastCommand {
  name: string;
  args: string[];
}

export function extractTopLevelFastCommands(raw: string): FastCommand[] {
  const commands: FastCommand[] = [];

  for (const segment of splitTopLevelSegments(raw)) {
    const tokens = tokenizeShellLike(segment);
    if (tokens.length === 0) continue;

    const [name, ...args] = tokens;
    if (!name) continue;
    commands.push({ name, args });
  }

  return commands;
}

export function isFastAllowSafe(raw: string): boolean {
  return !/[`]|\$\(|[<>]|\|\||&&|[;]|\(|\)|\n/.test(raw);
}

function splitTopLevelSegments(raw: string): string[] {
  const segments: string[] = [];
  let current = "";
  let quote: "single" | "double" | "backtick" | null = null;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    const next = raw[i + 1];

    if (quote === null && ch === "\\") {
      current += ch;
      if (next !== undefined) {
        current += next;
        i++;
      }
      continue;
    }

    if (quote === null) {
      if (ch === "'") {
        quote = "single";
        current += ch;
        continue;
      }
      if (ch === '"') {
        quote = "double";
        current += ch;
        continue;
      }
      if (ch === "`") {
        quote = "backtick";
        current += ch;
        continue;
      }

      if (ch === "\n" || ch === ";" || ch === "|") {
        if (current.trim().length > 0) segments.push(current.trim());
        current = "";

        if (ch === "|" && next === "|") {
          i++;
        }
        continue;
      }

      if (ch === "&") {
        if (current.trim().length > 0) segments.push(current.trim());
        current = "";
        if (next === "&") i++;
        continue;
      }

      current += ch;
      continue;
    }

    current += ch;
    if (
      (quote === "single" && ch === "'") ||
      (quote === "double" && ch === '"') ||
      (quote === "backtick" && ch === "`")
    ) {
      quote = null;
    }
  }

  if (current.trim().length > 0) segments.push(current.trim());
  return segments;
}

function tokenizeShellLike(segment: string): string[] {
  const tokens: string[] = [];
  const re = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\S+/g;

  let match: RegExpExecArray | null;
  while ((match = re.exec(segment)) !== null) {
    tokens.push(match[0]);
  }

  return tokens;
}
