import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BUILTIN_PRESETS,
  buildEffectivePresetPolicies,
  buildPresetContext,
} from "../src/presets.ts";

test("BUILTIN_PRESETS", async (t) => {
  await t.test("includes destructive-calls preset", () => {
    const preset = BUILTIN_PRESETS["destructive-calls"];
    assert.ok(preset);
    assert.equal(preset.rules?.["rm -rf /"], "deny");
    assert.equal(preset.rules?.shutdown, "deny");
  });

  await t.test("includes pi-bash-restrict mixed policy preset", () => {
    const preset = BUILTIN_PRESETS["pi-bash-restrict"];
    assert.ok(preset);
    assert.deepEqual(preset.toolPolicies, {
      grep: "deny",
      find: "deny",
      ls: "deny",
    });
    assert.equal(preset.rules?.sudo, "deny");
    assert.equal(preset.rules?.["sed -i"], "deny");
    assert.equal(preset.guards?.["command-substitution"], "deny");
    assert.equal(preset.guards?.redirects, "deny");
  });
});

test("buildPresetContext", async (t) => {
  await t.test(
    "concatenates global + project presets and lets project override custom presets by name",
    () => {
      const context = buildPresetContext(
        {
          presets: ["destructive-calls", "team"],
          customPresets: {
            team: { rules: { git: "ask" }, toolPolicies: { grep: "deny" } },
          },
        },
        {
          presets: ["project-safe"],
          customPresets: {
            team: { rules: { git: "deny" } },
            "project-safe": { guards: { redirects: "deny" } },
          },
        },
      );

      assert.deepEqual(context.activePresets, [
        "destructive-calls",
        "team",
        "project-safe",
      ]);
      assert.deepEqual(context.customPresets, {
        team: { rules: { git: "deny" } },
        "project-safe": { guards: { redirects: "deny" } },
      });
    },
  );
});

test("buildEffectivePresetPolicies", async (t) => {
  await t.test("uses last-match-wins across active preset order", () => {
    const result = buildEffectivePresetPolicies({
      activePresets: ["first", "second"],
      customPresets: {
        first: {
          rules: { git: "deny", "git status": "allow" },
          toolPolicies: { grep: "deny" },
          guards: { redirects: "deny" },
        },
        second: {
          rules: { git: "allow" },
          toolPolicies: { grep: "allow", find: "deny" },
          guards: { redirects: "allow", subshells: "deny" },
        },
      },
    });

    assert.equal(result.rules.git, "allow");
    assert.equal(result.rules["git status"], "allow");
    assert.equal(result.toolPolicies.grep, "allow");
    assert.equal(result.toolPolicies.find, "deny");
    assert.equal(result.guards.redirects, "allow");
    assert.equal(result.guards.subshells, "deny");
    assert.deepEqual(result.unknownPresetNames, []);
  });

  await t.test("tracks unknown preset names", () => {
    const result = buildEffectivePresetPolicies({
      activePresets: ["destructive-calls", "missing"],
      customPresets: {},
    });

    assert.equal(result.rules["rm -rf /"], "deny");
    assert.deepEqual(result.unknownPresetNames, ["missing"]);
  });
});
