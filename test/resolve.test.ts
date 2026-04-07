import assert from "node:assert/strict";
import { test } from "node:test";
import { parse as parseBash } from "unbash";
import { extractAllCommandsFromAST } from "../src/extract.ts";
import {
	resolveCommandAction,
	resolveCommandDecision,
} from "../src/resolve.ts";

test("resolveCommandAction", async (t) => {
	function cmd(name: string, args: string[]) {
		const raw = [name, ...args].join(" ");
		return extractAllCommandsFromAST(parseBash(raw), raw)[0]!;
	}

	await t.test("allows base command when in rules", () => {
		const rules = { git: "allow" as const };
		assert.equal(resolveCommandAction(cmd("git", ["status"]), rules), "allow");
		assert.equal(
			resolveCommandAction(cmd("git", ["commit", "-m", "msg"]), rules),
			"allow",
		);
		assert.equal(resolveCommandAction(cmd("git", []), rules), "allow");
	});

	await t.test("allows specific subcommand", () => {
		assert.equal(
			resolveCommandAction(cmd("git", ["status"]), { "git status": "allow" }),
			"allow",
		);
	});

	await t.test("allows subcommand with extra trailing args", () => {
		assert.equal(
			resolveCommandAction(cmd("git", ["status", "--short"]), {
				"git status": "allow",
			}),
			"allow",
		);
		assert.equal(
			resolveCommandAction(cmd("jira", ["issue", "view", "XXX-123"]), {
				"jira issue view": "allow",
			}),
			"allow",
		);
	});

	await t.test("allows subcommand with extra flags interspersed", () => {
		assert.equal(
			resolveCommandAction(cmd("git", ["branch", "-v", "--show-current"]), {
				"git branch --show-current": "allow",
			}),
			"allow",
		);
	});

	await t.test(
		"asks for other subcommands when only specific one is allowed",
		() => {
			const rules = { "git status": "allow" as const };
			assert.equal(
				resolveCommandAction(cmd("git", ["commit", "-m", "msg"]), rules),
				"ask",
			);
			assert.equal(resolveCommandAction(cmd("git", []), rules), "ask");
		},
	);

	await t.test("asks when required tokens are missing", () => {
		assert.equal(
			resolveCommandAction(cmd("git", ["branch", "-D", "main"]), {
				"git branch --show-current": "allow",
			}),
			"ask",
		);
	});

	await t.test("asks for unknown commands", () => {
		assert.equal(
			resolveCommandAction(cmd("curl", ["evil.com"]), {
				ls: "allow",
				cat: "allow",
			}),
			"ask",
		);
	});

	await t.test(
		"last match wins — base rule after subcommand rule overrides it",
		() => {
			const rules = { "git status": "ask" as const, git: "allow" as const };
			assert.equal(
				resolveCommandAction(cmd("git", ["status"]), rules),
				"allow",
			);
		},
	);

	await t.test(
		"last match wins — subcommand rule after base rule overrides it",
		() => {
			const rules = { git: "allow" as const, "git status": "ask" as const };
			assert.equal(resolveCommandAction(cmd("git", ["status"]), rules), "ask");
		},
	);

	await t.test("* matches any command", () => {
		assert.equal(
			resolveCommandAction(cmd("curl", ["evil.com"]), { "*": "allow" }),
			"allow",
		);
		assert.equal(
			resolveCommandAction(cmd("rm", ["-rf", "/"]), { "*": "allow" }),
			"allow",
		);
	});

	await t.test("deny is a valid action", () => {
		assert.equal(
			resolveCommandAction(cmd("git", ["push"]), {
				"git push": "deny" as const,
			}),
			"deny",
		);
	});

	await t.test("last match wins across allow, ask, and deny", () => {
		const rules = {
			git: "allow" as const,
			"git push": "deny" as const,
			"git push origin": "ask" as const,
		};
		assert.equal(
			resolveCommandAction(cmd("git", ["push", "origin", "main"]), rules),
			"ask",
		);
	});

	await t.test("* can deny any command", () => {
		assert.equal(
			resolveCommandAction(cmd("rm", ["-rf", "/"]), { "*": "deny" as const }),
			"deny",
		);
	});

	await t.test("* is overridden by later specific rule", () => {
		const rules = { "*": "allow" as const, curl: "ask" as const };
		assert.equal(resolveCommandAction(cmd("curl", ["evil.com"]), rules), "ask");
		assert.equal(resolveCommandAction(cmd("ls", []), rules), "allow");
	});

	await t.test("specific rule is overridden by later *", () => {
		const rules = { curl: "ask" as const, "*": "allow" as const };
		assert.equal(
			resolveCommandAction(cmd("curl", ["evil.com"]), rules),
			"allow",
		);
	});

	await t.test("returns ask when no rule matches", () => {
		assert.equal(resolveCommandAction(cmd("curl", ["evil.com"]), {}), "ask");
	});

	await t.test("multiple subcommands can be allowed independently", () => {
		const rules = {
			"git status": "allow" as const,
			"git log": "allow" as const,
		};
		assert.equal(resolveCommandAction(cmd("git", ["status"]), rules), "allow");
		assert.equal(
			resolveCommandAction(cmd("git", ["log", "--oneline"]), rules),
			"allow",
		);
		assert.equal(resolveCommandAction(cmd("git", ["push"]), rules), "ask");
	});

	await t.test("multi-level subcommand matching", () => {
		const rules = {
			"jira issue view": "allow" as const,
			"jira issue list": "allow" as const,
		};
		assert.equal(
			resolveCommandAction(cmd("jira", ["issue", "view", "PROJ-123"]), rules),
			"allow",
		);
		assert.equal(
			resolveCommandAction(
				cmd("jira", ["issue", "list", "--project", "PROJ"]),
				rules,
			),
			"allow",
		);
		assert.equal(
			resolveCommandAction(cmd("jira", ["issue", "create"]), rules),
			"ask",
		);
		assert.equal(
			resolveCommandAction(cmd("jira", ["project", "list"]), rules),
			"ask",
		);
	});

	await t.test("allows dangerous command only with required flag", () => {
		const rules = { "terraform apply --dry-run": "allow" as const };
		assert.equal(
			resolveCommandAction(cmd("terraform", ["apply", "--dry-run"]), rules),
			"allow",
		);
		assert.equal(
			resolveCommandAction(
				cmd("terraform", ["apply", "-v", "--dry-run"]),
				rules,
			),
			"allow",
		);
		assert.equal(
			resolveCommandAction(cmd("terraform", ["apply"]), rules),
			"ask",
		);
		assert.equal(
			resolveCommandAction(cmd("terraform", ["apply", "--force"]), rules),
			"ask",
		);
	});
});

test("resolveCommandDecision", async (t) => {
	function cmd(name: string, args: string[]) {
		const raw = [name, ...args].join(" ");
		return extractAllCommandsFromAST(parseBash(raw), raw)[0]!;
	}

	await t.test("returns deny decision with winning pattern and layer", () => {
		const layers = {
			default: { git: "allow" as const },
			global: { "git push": "deny" as const },
			project: {},
			session: {},
		};

		assert.deepEqual(resolveCommandDecision(cmd("git", ["push"]), layers), {
			action: "deny",
			pattern: "git push",
			layer: "global",
		});
	});

	await t.test("returns ask with no metadata when no rule matches", () => {
		const layers = {
			default: {},
			global: {},
			project: {},
			session: {},
		};

		assert.deepEqual(
			resolveCommandDecision(cmd("curl", ["evil.com"]), layers),
			{
				action: "ask",
			},
		);
	});

	await t.test("last match wins across layers and insertion order", () => {
		const layers = {
			default: { git: "allow" as const },
			global: { "git push": "deny" as const },
			project: { "git push origin": "ask" as const },
			session: {},
		};

		assert.deepEqual(
			resolveCommandDecision(cmd("git", ["push", "origin", "main"]), layers),
			{
				action: "ask",
				pattern: "git push origin",
				layer: "project",
			},
		);
	});
});
