import type { CommandRef } from "./types.ts";
import { formatCommand } from "./format.ts";

export interface ApprovalPromptOptions {
  maxLength?: number;
  argMaxLength?: number;
}

export function buildApprovalPrompt(
  allCommands: CommandRef[],
  unauthorizedCommands: CommandRef[],
  options?: ApprovalPromptOptions,
): string {
  const unauthorizedSet = new Set(unauthorizedCommands);
  const lines = allCommands.map(command => {
    const marker = unauthorizedSet.has(command) ? "✖" : "✔";
    return `${marker} ${formatCommand(command, options)}`;
  });

  return [
    "⚠️ Unapproved Commands",
    "",
    ...lines,
  ].join("\n");
}
