import type { Script } from "unbash";
import type { PolicyAction } from "./presets.ts";

export type GuardName =
  | "command-substitution"
  | "process-substitution"
  | "variable-expansion"
  | "redirects"
  | "subshells"
  | "background-execution"
  | "control-flow"
  | "function-definition";

const GUARD_ORDER: GuardName[] = [
  "command-substitution",
  "process-substitution",
  "variable-expansion",
  "redirects",
  "subshells",
  "background-execution",
  "control-flow",
  "function-definition",
];

export const GUARD_NAMES = new Set<GuardName>(GUARD_ORDER);

export function detectTriggeredGuards(ast: Script): Set<GuardName> {
  const triggered = new Set<GuardName>();

  walk(ast, (node) => {
    if (!node || typeof node !== "object") return;

    const maybeType = (node as { type?: unknown }).type;
    if (typeof maybeType === "string") {
      switch (maybeType) {
        case "CommandExpansion":
        case "ArithmeticCommandExpansion":
          triggered.add("command-substitution");
          break;
        case "ProcessSubstitution":
          triggered.add("process-substitution");
          break;
        case "ParameterExpansion":
        case "ArithmeticExpansion":
          triggered.add("variable-expansion");
          break;
        case "Subshell":
          triggered.add("subshells");
          break;
        case "If":
        case "While":
        case "For":
        case "Select":
        case "Case":
        case "ArithmeticFor":
        case "AndOr":
          triggered.add("control-flow");
          break;
        case "Function":
          triggered.add("function-definition");
          break;
      }
    }

    const statement = node as { type?: string; background?: boolean };
    if (statement.type === "Statement" && statement.background === true) {
      triggered.add("background-execution");
    }

    const withRedirects = node as { redirects?: unknown[] };
    if (Array.isArray(withRedirects.redirects) && withRedirects.redirects.length > 0) {
      triggered.add("redirects");
    }
  });

  return triggered;
}

export function findDeniedGuard(
  triggered: Set<GuardName>,
  policies: Record<string, PolicyAction>,
): GuardName | undefined {
  for (const guard of GUARD_ORDER) {
    if (triggered.has(guard) && policies[guard] === "deny") {
      return guard;
    }
  }
  return undefined;
}

function walk(node: unknown, visitor: (value: unknown) => void) {
  visitor(node);

  if (!node || typeof node !== "object") return;

  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const item of value) walk(item, visitor);
      continue;
    }
    walk(value, visitor);
  }
}
