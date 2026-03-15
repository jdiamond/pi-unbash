import { test } from "node:test";
import assert from "node:assert/strict";
import { parse as parseBash } from "unbash";
import { extractAllCommandsFromAST, isCommandAllowed } from "../src/extract.ts";
import { buildApprovalPrompt } from "../src/prompt.ts";

function extract(raw: string) {
  return extractAllCommandsFromAST(parseBash(raw), raw);
}

test("buildApprovalPrompt", async (t) => {
  await t.test("shows allowed commands for context alongside unapproved ones", () => {
    const commands = extract("cd /Users/jdiamond/code/pi-nudge && npx tsc --noEmit 2>&1");
    const unauthorized = commands.filter(cmd => !isCommandAllowed(cmd, ["cd"]));

    assert.equal(
      buildApprovalPrompt(commands, unauthorized, { maxLength: 40, argMaxLength: 40 }),
      [
        "⚠️ Unapproved Commands",
        "",
        "✔ cd /Users/jdiamond/code/pi-nudge",
        "✖ npx tsc --noEmit 2>&1",
      ].join("\n"),
    );
  });

  await t.test("preserves command order and does not deduplicate entries", () => {
    const commands = extract("echo ok && npm test && npm test");
    const unauthorized = commands.filter(cmd => !isCommandAllowed(cmd, ["echo"]));

    assert.equal(
      buildApprovalPrompt(commands, unauthorized, { maxLength: 200, argMaxLength: 200 }),
      [
        "⚠️ Unapproved Commands",
        "",
        "✔ echo ok",
        "✖ npm test",
        "✖ npm test",
      ].join("\n"),
    );
  });
});
