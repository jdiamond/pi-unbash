import { test } from "node:test";
import assert from "node:assert/strict";
import { parseUnbashArgs } from "../src/index.ts";

test("parseUnbashArgs", async (t) => {
  await t.test("parses single-token target", () => {
    assert.deepEqual(parseUnbashArgs("allow git"), { action: "allow", target: "git" });
  });

  await t.test("parses multi-token target", () => {
    assert.deepEqual(parseUnbashArgs("allow git status"), { action: "allow", target: "git status" });
  });

  await t.test("collapses extra whitespace", () => {
    assert.deepEqual(parseUnbashArgs("  deny   git   branch   --show-current  "), {
      action: "deny",
      target: "git branch --show-current",
    });
  });

  await t.test("returns empty target when action has no argument", () => {
    assert.deepEqual(parseUnbashArgs("toggle"), { action: "toggle", target: "" });
  });

  await t.test("returns empty action/target for empty input", () => {
    assert.deepEqual(parseUnbashArgs("   "), { action: "", target: "" });
  });
});
