import { test } from "node:test";
import assert from "node:assert/strict";
import { getUnbashConfigFromSettings, validateLoadedUnbashConfig } from "../src/index.ts";
import { FORMAT_COMMAND_DEFAULT_MAX_LENGTH, FORMAT_COMMAND_DEFAULT_ARG_MAX_LENGTH } from "../src/format.ts";
import { DEFAULT_ALWAYS_ALLOWED } from "../src/defaults.ts";

const displayDefaults = {
  commandDisplayMaxLength: FORMAT_COMMAND_DEFAULT_MAX_LENGTH,
  commandDisplayArgMaxLength: FORMAT_COMMAND_DEFAULT_ARG_MAX_LENGTH,
};

test("validateLoadedUnbashConfig", async (t) => {
  await t.test("accepts valid config", () => {
    const result = validateLoadedUnbashConfig({ enabled: false, alwaysAllowed: ["git", "git status"] });
    assert.deepEqual(result.config, { enabled: false, alwaysAllowed: ["git", "git status"], ...displayDefaults });
    assert.equal(result.warning, undefined);
  });

  await t.test("uses safe fallback for invalid top-level shape", () => {
    const result = validateLoadedUnbashConfig("bad");
    assert.deepEqual(result.config, { enabled: true, alwaysAllowed: [], ...displayDefaults });
    assert.ok(result.warning);
  });

  await t.test("recovers valid enabled when alwaysAllowed is invalid", () => {
    const result = validateLoadedUnbashConfig({ enabled: false, alwaysAllowed: 42 });
    assert.deepEqual(result.config, { enabled: false, alwaysAllowed: [], ...displayDefaults });
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
      ...displayDefaults,
    });
    assert.ok(result.warning?.includes("alwaysAllowed"));
  });

  await t.test("accepts custom display settings", () => {
    const result = validateLoadedUnbashConfig({ enabled: true, alwaysAllowed: [], commandDisplayMaxLength: 80, commandDisplayArgMaxLength: 30 });
    assert.equal(result.config.commandDisplayMaxLength, 80);
    assert.equal(result.config.commandDisplayArgMaxLength, 30);
    assert.equal(result.warning, undefined);
  });

  await t.test("rejects invalid display settings", () => {
    const result = validateLoadedUnbashConfig({ enabled: true, alwaysAllowed: [], commandDisplayMaxLength: "big", commandDisplayArgMaxLength: -1 });
    assert.equal(result.config.commandDisplayMaxLength, FORMAT_COMMAND_DEFAULT_MAX_LENGTH);
    assert.equal(result.config.commandDisplayArgMaxLength, FORMAT_COMMAND_DEFAULT_ARG_MAX_LENGTH);
    assert.ok(result.warning);
  });
});

test("getUnbashConfigFromSettings", async (t) => {
  await t.test("uses defaults when the unbash key is missing", () => {
    const result = getUnbashConfigFromSettings({ other: true });
    assert.deepEqual(result.config, { enabled: true, alwaysAllowed: DEFAULT_ALWAYS_ALLOWED, ...displayDefaults });
    assert.equal(result.warning, undefined);
  });

  await t.test("validates a falsey unbash value instead of falling back to defaults", () => {
    const result = getUnbashConfigFromSettings({ unbash: null });
    assert.deepEqual(result.config, { enabled: true, alwaysAllowed: [], ...displayDefaults });
    assert.ok(result.warning);
  });
});
