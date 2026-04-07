import assert from "node:assert/strict";
import { test } from "node:test";
import { parseUnbashArgs, upsertRuleAtEnd } from "../src/index.ts";

test("parseUnbashArgs", async (t) => {
	await t.test("parses single-token target", () => {
		assert.deepEqual(parseUnbashArgs("allow git"), {
			action: "allow",
			target: "git",
		});
	});

	await t.test("parses multi-token target", () => {
		assert.deepEqual(parseUnbashArgs("allow git status"), {
			action: "allow",
			target: "git status",
		});
	});

	await t.test("collapses extra whitespace", () => {
		assert.deepEqual(
			parseUnbashArgs("  deny   git   branch   --show-current  "),
			{
				action: "deny",
				target: "git branch --show-current",
			},
		);
	});

	await t.test("returns empty target when action has no argument", () => {
		assert.deepEqual(parseUnbashArgs("toggle"), {
			action: "toggle",
			target: "",
		});
	});

	await t.test("parses list action with no target", () => {
		assert.deepEqual(parseUnbashArgs("list"), { action: "list", target: "" });
	});

	await t.test("returns empty action/target for empty input", () => {
		assert.deepEqual(parseUnbashArgs("   "), { action: "", target: "" });
	});
});

test("upsertRuleAtEnd", async (t) => {
	await t.test("moves existing rule to the end with updated action", () => {
		assert.deepEqual(
			upsertRuleAtEnd({ "git": "allow", "git push": "ask" }, "git", "deny"),
			{ "git push": "ask", "git": "deny" },
		);
	});

	await t.test("inserts a brand-new rule at the end", () => {
		assert.deepEqual(
			upsertRuleAtEnd({ "git": "allow" }, "git push", "deny"),
			{ "git": "allow", "git push": "deny" },
		);
	});
});
