import { parse as parseBash } from "unbash";
import type {
  ArithmeticExpansionPart,
  ArithmeticExpression,
  AssignmentPrefix,
  Command,
  CommandExpansionPart,
  Node,
  ParameterExpansionPart,
  ProcessSubstitutionPart,
  Redirect,
  Script,
  TestExpression,
  Word,
  WordPart,
} from "unbash";
import type { CommandRef } from "./types.ts";

export type { CommandRef };

export function extractAllCommandsFromAST(node: Script | Node, source: string): CommandRef[] {
  const commands: CommandRef[] = [];
  collectNode(node, source, commands);
  return commands;
}

function collectNode(node: Script | Node | undefined, source: string, commands: CommandRef[]) {
  if (!node) return;

  switch (node.type) {
    case "Script":
    case "AndOr":
    case "Pipeline":
    case "CompoundList":
      for (const child of node.commands) {
        collectNode(child, source, commands);
      }
      return;

    case "Statement":
      collectNode(node.command, source, commands);
      for (const redirect of node.redirects) {
        collectRedirect(redirect, source, commands);
      }
      return;

    case "Command":
      collectCommand(node, source, commands);
      return;

    case "Subshell":
    case "BraceGroup":
      collectNode(node.body, source, commands);
      return;

    case "If":
      collectNode(node.clause, source, commands);
      collectNode(node.then, source, commands);
      if (node.else) collectNode(node.else, source, commands);
      return;

    case "While":
      collectNode(node.clause, source, commands);
      collectNode(node.body, source, commands);
      return;

    case "For":
      collectWord(node.name, source, commands);
      for (const word of node.wordlist) {
        collectWord(word, source, commands);
      }
      collectNode(node.body, source, commands);
      return;

    case "Select":
      collectWord(node.name, source, commands);
      for (const word of node.wordlist) {
        collectWord(word, source, commands);
      }
      collectNode(node.body, source, commands);
      return;

    case "Case":
      collectWord(node.word, source, commands);
      for (const item of node.items) {
        collectCaseItem(item, source, commands);
      }
      return;

    case "Function":
      collectWord(node.name, source, commands);
      collectNode(node.body, source, commands);
      for (const redirect of node.redirects) {
        collectRedirect(redirect, source, commands);
      }
      return;

    case "Coproc":
      if (node.name) collectWord(node.name, source, commands);
      collectNode(node.body, source, commands);
      for (const redirect of node.redirects) {
        collectRedirect(redirect, source, commands);
      }
      return;

    case "TestCommand":
      collectTestExpression(node.expression, source, commands);
      return;

    case "ArithmeticFor":
      collectArithmeticExpression(node.initialize, source, commands);
      collectArithmeticExpression(node.test, source, commands);
      collectArithmeticExpression(node.update, source, commands);
      collectNode(node.body, source, commands);
      return;

    case "ArithmeticCommand":
      collectArithmeticExpression(node.expression, source, commands);
      return;
  }
}

function collectCommand(node: Command, source: string, commands: CommandRef[]) {
  if (node.name) {
    commands.push({ node, source });
  }

  for (const prefix of node.prefix) {
    collectAssignment(prefix, source, commands);
  }

  for (const word of node.suffix) {
    collectWord(word, source, commands);
  }

  for (const redirect of node.redirects) {
    collectRedirect(redirect, source, commands);
  }
}

function collectAssignment(assignment: AssignmentPrefix, source: string, commands: CommandRef[]) {
  if (assignment.value) {
    collectWord(assignment.value, source, commands);
  }

  if (assignment.array) {
    for (const word of assignment.array) {
      collectWord(word, source, commands);
    }
  }
}

function collectRedirect(redirect: Redirect, source: string, commands: CommandRef[]) {
  if (redirect.target) {
    collectWord(redirect.target, source, commands);
  }

  if (redirect.body?.parts) {
    collectWord(redirect.body, source, commands);
    return;
  }

  if (redirect.content && redirect.heredocQuoted !== true) {
    collectCommandsFromShellText(redirect.content, commands);
  }
}

function collectWord(word: Word | undefined, source: string, commands: CommandRef[]) {
  if (!word?.parts) return;
  for (const part of word.parts) {
    collectWordPart(part, source, commands);
  }
}

function collectCommandsFromShellText(text: string, commands: CommandRef[]) {
  const ast = parseBash(text);
  collectEmbeddedCommandsFromNode(ast, text, commands);
}

function collectEmbeddedCommandsFromNode(node: Script | Node | undefined, source: string, commands: CommandRef[]) {
  if (!node) return;

  switch (node.type) {
    case "Script":
    case "AndOr":
    case "Pipeline":
    case "CompoundList":
      for (const child of node.commands) {
        collectEmbeddedCommandsFromNode(child, source, commands);
      }
      return;

    case "Statement":
      collectEmbeddedCommandsFromNode(node.command, source, commands);
      for (const redirect of node.redirects) {
        collectEmbeddedRedirect(redirect, source, commands);
      }
      return;

    case "Command":
      collectWord(node.name, source, commands);
      for (const prefix of node.prefix) {
        collectAssignment(prefix, source, commands);
      }
      for (const word of node.suffix) {
        collectWord(word, source, commands);
      }
      for (const redirect of node.redirects) {
        collectEmbeddedRedirect(redirect, source, commands);
      }
      return;

    case "Subshell":
    case "BraceGroup":
      collectEmbeddedCommandsFromNode(node.body, source, commands);
      return;

    case "If":
      collectEmbeddedCommandsFromNode(node.clause, source, commands);
      collectEmbeddedCommandsFromNode(node.then, source, commands);
      if (node.else) collectEmbeddedCommandsFromNode(node.else, source, commands);
      return;

    case "While":
      collectEmbeddedCommandsFromNode(node.clause, source, commands);
      collectEmbeddedCommandsFromNode(node.body, source, commands);
      return;

    case "For":
      collectWord(node.name, source, commands);
      for (const word of node.wordlist) {
        collectWord(word, source, commands);
      }
      collectEmbeddedCommandsFromNode(node.body, source, commands);
      return;

    case "Select":
      collectWord(node.name, source, commands);
      for (const word of node.wordlist) {
        collectWord(word, source, commands);
      }
      collectEmbeddedCommandsFromNode(node.body, source, commands);
      return;

    case "Case":
      collectWord(node.word, source, commands);
      for (const item of node.items) {
        collectEmbeddedCaseItem(item, source, commands);
      }
      return;

    case "Function":
      collectWord(node.name, source, commands);
      collectEmbeddedCommandsFromNode(node.body, source, commands);
      for (const redirect of node.redirects) {
        collectEmbeddedRedirect(redirect, source, commands);
      }
      return;

    case "Coproc":
      if (node.name) collectWord(node.name, source, commands);
      collectEmbeddedCommandsFromNode(node.body, source, commands);
      for (const redirect of node.redirects) {
        collectEmbeddedRedirect(redirect, source, commands);
      }
      return;

    case "TestCommand":
      collectTestExpression(node.expression, source, commands);
      return;

    case "ArithmeticFor":
      collectArithmeticExpression(node.initialize, source, commands);
      collectArithmeticExpression(node.test, source, commands);
      collectArithmeticExpression(node.update, source, commands);
      collectEmbeddedCommandsFromNode(node.body, source, commands);
      return;

    case "ArithmeticCommand":
      collectArithmeticExpression(node.expression, source, commands);
      return;
  }
}

function collectEmbeddedRedirect(redirect: Redirect, source: string, commands: CommandRef[]) {
  if (redirect.target) {
    collectWord(redirect.target, source, commands);
  }

  if (redirect.body?.parts) {
    collectWord(redirect.body, source, commands);
    return;
  }

  if (redirect.content && redirect.heredocQuoted !== true) {
    collectCommandsFromShellText(redirect.content, commands);
  }
}

function collectWordPart(
  part: WordPart | CommandExpansionPart | ProcessSubstitutionPart,
  source: string,
  commands: CommandRef[],
) {
  switch (part.type) {
    case "DoubleQuoted":
    case "LocaleString":
      for (const child of part.parts) {
        collectWordPart(child, source, commands);
      }
      return;

    case "CommandExpansion":
    case "ProcessSubstitution":
      if (part.script) {
        collectNode(part.script, expansionSource(part, source), commands);
      }
      return;

    case "ParameterExpansion":
      collectParameterExpansion(part, source, commands);
      return;

    case "ArithmeticExpansion":
      collectArithmeticExpression(part.expression, source, commands);
      return;

    default:
      return;
  }
}

function collectParameterExpansion(part: ParameterExpansionPart, source: string, commands: CommandRef[]) {
  if (part.operand) {
    collectWord(part.operand, source, commands);
  }

  if (part.slice) {
    collectWord(part.slice.offset, source, commands);
    if (part.slice.length) {
      collectWord(part.slice.length, source, commands);
    }
  }

  if (part.replace) {
    collectWord(part.replace.pattern, source, commands);
    collectWord(part.replace.replacement, source, commands);
  }
}

function expansionSource(part: CommandExpansionPart | ProcessSubstitutionPart, fallbackSource: string): string {
  if (part.inner != null) return part.inner;

  const text = part.text;
  if (text.startsWith("$(") && text.endsWith(")")) {
    return text.slice(2, -1);
  }
  if ((text.startsWith("<(") || text.startsWith(">(")) && text.endsWith(")")) {
    return text.slice(2, -1);
  }
  if (text.startsWith("`") && text.endsWith("`")) {
    return text.slice(1, -1);
  }

  return fallbackSource;
}

function collectCaseItem(item: { pattern: Word[]; body: Node }, source: string, commands: CommandRef[]) {
  for (const pattern of item.pattern) {
    collectWord(pattern, source, commands);
  }
  collectNode(item.body, source, commands);
}

function collectEmbeddedCaseItem(item: { pattern: Word[]; body: Node }, source: string, commands: CommandRef[]) {
  for (const pattern of item.pattern) {
    collectWord(pattern, source, commands);
  }
  collectEmbeddedCommandsFromNode(item.body, source, commands);
}

function collectTestExpression(expr: TestExpression, source: string, commands: CommandRef[]) {
  switch (expr.type) {
    case "TestUnary":
      collectWord(expr.operand, source, commands);
      return;
    case "TestBinary":
      collectWord(expr.left, source, commands);
      collectWord(expr.right, source, commands);
      return;
    case "TestLogical":
      collectTestExpression(expr.left, source, commands);
      collectTestExpression(expr.right, source, commands);
      return;
    case "TestNot":
      collectTestExpression(expr.operand, source, commands);
      return;
    case "TestGroup":
      collectTestExpression(expr.expression, source, commands);
      return;
  }
}

function collectArithmeticExpression(expr: ArithmeticExpression | undefined, source: string, commands: CommandRef[]) {
  if (!expr) return;

  switch (expr.type) {
    case "ArithmeticBinary":
      collectArithmeticExpression(expr.left, source, commands);
      collectArithmeticExpression(expr.right, source, commands);
      return;
    case "ArithmeticUnary":
      collectArithmeticExpression(expr.operand, source, commands);
      return;
    case "ArithmeticTernary":
      collectArithmeticExpression(expr.test, source, commands);
      collectArithmeticExpression(expr.consequent, source, commands);
      collectArithmeticExpression(expr.alternate, source, commands);
      return;
    case "ArithmeticGroup":
      collectArithmeticExpression(expr.expression, source, commands);
      return;
    case "ArithmeticCommandExpansion":
      if (expr.script) {
        // Extract inner source from text like "$(cmd)" -> "cmd"
        const innerSource = expr.text.startsWith("$(") && expr.text.endsWith(")")
          ? expr.text.slice(2, -1)
          : expr.text;
        collectNode(expr.script, innerSource, commands);
      } else if (expr.inner) {
        // Parse the inner text and collect commands (for double-quoted context)
        const innerAst = parseBash(expr.inner);
        collectArithmeticCommands(innerAst, expr.inner, commands);
      }
      return;
    case "ArithmeticWord":
      return;
  }
}

function collectArithmeticCommands(node: Script | Node | undefined, source: string, commands: CommandRef[]) {
  if (!node) return;

  switch (node.type) {
    case "Script":
    case "AndOr":
    case "Pipeline":
    case "CompoundList":
      for (const child of node.commands) {
        collectArithmeticCommands(child, source, commands);
      }
      return;

    case "Statement":
      collectArithmeticCommands(node.command, source, commands);
      for (const redirect of node.redirects) {
        collectArithmeticRedirect(redirect, source, commands);
      }
      return;

    case "Command":
      if (node.name) {
        commands.push({ node, source });
      }
      for (const prefix of node.prefix) {
        collectAssignment(prefix, source, commands);
      }
      for (const word of node.suffix) {
        collectWord(word, source, commands);
      }
      for (const redirect of node.redirects) {
        collectArithmeticRedirect(redirect, source, commands);
      }
      return;

    case "Subshell":
    case "BraceGroup":
      collectArithmeticCommands(node.body, source, commands);
      return;

    case "If":
      collectArithmeticCommands(node.clause, source, commands);
      collectArithmeticCommands(node.then, source, commands);
      if (node.else) collectArithmeticCommands(node.else, source, commands);
      return;

    case "While":
      collectArithmeticCommands(node.clause, source, commands);
      collectArithmeticCommands(node.body, source, commands);
      return;

    case "For":
      collectWord(node.name, source, commands);
      for (const word of node.wordlist) {
        collectWord(word, source, commands);
      }
      collectArithmeticCommands(node.body, source, commands);
      return;

    case "Select":
      collectWord(node.name, source, commands);
      for (const word of node.wordlist) {
        collectWord(word, source, commands);
      }
      collectArithmeticCommands(node.body, source, commands);
      return;

    case "Case":
      collectWord(node.word, source, commands);
      for (const item of node.items) {
        collectArithmeticCaseItem(item, source, commands);
      }
      return;

    case "Function":
      collectWord(node.name, source, commands);
      collectArithmeticCommands(node.body, source, commands);
      for (const redirect of node.redirects) {
        collectArithmeticRedirect(redirect, source, commands);
      }
      return;

    case "Coproc":
      if (node.name) collectWord(node.name, source, commands);
      collectArithmeticCommands(node.body, source, commands);
      for (const redirect of node.redirects) {
        collectArithmeticRedirect(redirect, source, commands);
      }
      return;

    case "TestCommand":
      collectTestExpression(node.expression, source, commands);
      return;

    case "ArithmeticFor":
      collectArithmeticExpression(node.initialize, source, commands);
      collectArithmeticExpression(node.test, source, commands);
      collectArithmeticExpression(node.update, source, commands);
      collectArithmeticCommands(node.body, source, commands);
      return;

    case "ArithmeticCommand":
      collectArithmeticExpression(node.expression, source, commands);
      return;
  }
}

function collectArithmeticRedirect(redirect: Redirect, source: string, commands: CommandRef[]) {
  if (redirect.target) {
    collectWord(redirect.target, source, commands);
  }
  if (redirect.body?.parts) {
    collectWord(redirect.body, source, commands);
    return;
  }
  if (redirect.content && redirect.heredocQuoted !== true) {
    collectCommandsFromShellText(redirect.content, commands);
  }
}

function collectArithmeticCaseItem(item: { pattern: Word[]; body: Node }, source: string, commands: CommandRef[]) {
  for (const pattern of item.pattern) {
    collectWord(pattern, source, commands);
  }
  collectArithmeticCommands(item.body, source, commands);
}

