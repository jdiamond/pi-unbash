import { test } from "node:test";
import assert from "node:assert/strict";
import { validateLoadedUnbashConfig } from "../src/index.ts";

test("validateLoadedUnbashConfig", async (t) => {
  await t.test("accepts valid config", () => {
    const result = validateLoadedUnbashConfig({ enabled: false, alwaysAllowed: ["git", "git status"] });
    assert.deepEqual(result.config, { enabled: false, alwaysAllowed: ["git", "git status"] });
    assert.equal(result.warning, undefined);
  });

  await t.test("uses safe fallback for invalid top-level shape", () => {
    const result = validateLoadedUnbashConfig("bad");
    assert.deepEqual(result.config, { enabled: true, alwaysAllowed: [] });
    assert.ok(result.warning);
  });

  await t.test("recovers valid enabled when alwaysAllowed is invalid", () => {
    const result = validateLoadedUnbashConfig({ enabled: false, alwaysAllowed: 42 });
    assert.deepEqual(result.config, { enabled: false, alwaysAllowed: [] });
    assert.ok(result.warning?.includes("alwaysAllowed"));
  });

  await t.test("recovers valid alwaysAllowed entries and drops invalid ones", () => {
    const result = validateLoadedUnbashConfig({
      enabled: true,
      alwaysAllowed: ["git", "   ", 123, "git status"],
    });

    assert.deepEqual(result.config, {
      enabled: true,
      alwaysAllowed: ["git", "git status"],
    });
    assert.ok(result.warning?.includes("alwaysAllowed"));
  });
});
