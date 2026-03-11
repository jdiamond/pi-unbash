export function extractAllCommandsFromAST(astNode: any): string[] {
  const commands: string[] = [];
  
  if (!astNode) return commands;

  // Base case: we found a concrete command
  if (astNode.type === "Command" && astNode.name?.text) {
    commands.push(astNode.name.text);
    
    // Commands might have suffixes containing subshells (e.g. `$(ls)`)
    if (Array.isArray(astNode.suffix)) {
      for (const suffixNode of astNode.suffix) {
        if (Array.isArray(suffixNode.parts)) {
          for (const part of suffixNode.parts) {
            if (part.type === "CommandExpansion" && part.script) {
              commands.push(...extractAllCommandsFromAST(part.script));
            }
          }
        }
      }
    }

    // Commands might have prefixes containing variable assignments with subshells
    // e.g. FOO=`rm -rf /` node app.js
    if (Array.isArray(astNode.prefix)) {
      for (const prefixNode of astNode.prefix) {
        if (prefixNode.type === "Assignment" && prefixNode.value?.parts) {
          for (const part of prefixNode.value.parts) {
            if (part.type === "CommandExpansion" && part.script) {
              commands.push(...extractAllCommandsFromAST(part.script));
            }
          }
        }
      }
    }
  }

  // Recursive case: Lists, Pipelines, Logic Gates (AndOr)
  if (astNode.type === "Script" || astNode.type === "AndOr" || astNode.type === "Pipeline") {
    const children = astNode.commands || [];
    for (const child of children) {
      commands.push(...extractAllCommandsFromAST(child));
    }
  }

  // Statement wrappers
  if (astNode.type === "Statement" && astNode.command) {
    commands.push(...extractAllCommandsFromAST(astNode.command));
  }

  return commands;
}