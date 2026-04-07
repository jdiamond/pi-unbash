import assert from "node:assert/strict";
import { test } from "node:test";
import { parse as parseBash } from "unbash";
import { extractAllCommandsFromAST } from "../src/extract.ts";
import { buildDeniedReason } from "../src/index.ts";

test("buildDeniedReason", async (t) => {
	function cmd(name: string, args: string[]) {
		const raw = [name, ...args].join(" ");
		return extractAllCommandsFromAST(parseBash(raw), raw)[0]!;
	}

	await t.test("includes layer, pattern, and command preview", () => {
		const decision = {
			action: "deny" as const,
			pattern: "git push",
			layer: "project" as const,
		};

		assert.equal(
			buildDeniedReason(cmd("git", ["push", "origin", "main"]), decision, {
				maxLength: 120,
				argMaxLength: 40,
			}),
			'Denied by project rule "git push": git push origin main',
		);
	});
});
