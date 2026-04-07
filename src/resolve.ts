import type { CommandRef } from "./types.ts";

export type RuleAction = "allow" | "ask" | "deny";
export type RuleLayerName = "default" | "global" | "project" | "session";

export interface RuleLayers {
	default: Record<string, RuleAction>;
	global: Record<string, RuleAction>;
	project: Record<string, RuleAction>;
	session: Record<string, RuleAction>;
}

export interface RuleDecision {
	action: RuleAction;
	pattern?: string;
	layer?: RuleLayerName;
}

export function getCommandName(cmd: CommandRef): string {
	return cmd.node.name?.value ?? cmd.node.name?.text ?? "";
}

export function getCommandArgs(cmd: CommandRef): string[] {
	return cmd.node.suffix.map((word) => word.value ?? word.text);
}

/**
 * Resolve the action for a command against a rules map.
 *
 * Rules are evaluated in insertion order; last match wins.
 * The special pattern "*" matches any command.
 *
 * Matching uses subsequence logic:
 * - "git" → matches all git commands (base command match)
 * - "git status" → matches `git status`, `git status --short`, etc.
 * - "git branch --show-current" → matches `git branch --show-current`,
 *   `git branch -v --show-current`, etc.
 * - "jira issue view" → matches `jira issue view XXX-123`, etc.
 *
 * The rule tokens must appear in order in the actual args,
 * but extra flags or positional args anywhere in the sequence are permitted.
 *
 * Returns "ask" if no rule matches.
 */
export function resolveCommandAction(
	cmd: CommandRef,
	rules: Record<string, RuleAction>,
): RuleAction {
	return resolveCommandDecision(cmd, {
		default: rules,
		global: {},
		project: {},
		session: {},
	}).action;
}

export function resolveCommandDecision(
	cmd: CommandRef,
	layers: RuleLayers,
): RuleDecision {
	const name = getCommandName(cmd);
	const args = getCommandArgs(cmd);

	let result: RuleDecision = { action: "ask" };

	for (const layer of ["default", "global", "project", "session"] as const) {
		for (const [pattern, action] of Object.entries(layers[layer])) {
			if (pattern === "*") {
				result = { action, pattern, layer };
				continue;
			}

			const tokens = pattern.split(" ");
			const patternName = tokens[0]!;
			const patternArgs = tokens.slice(1);

			if (patternName !== name) continue;

			if (patternArgs.length === 0 || isSubsequence(patternArgs, args)) {
				result = { action, pattern, layer };
			}
		}
	}

	return result;
}

/** Check if `needle` tokens appear in order within `haystack`. */
function isSubsequence(needle: string[], haystack: string[]): boolean {
	let ni = 0;
	for (let hi = 0; hi < haystack.length && ni < needle.length; hi++) {
		if (haystack[hi] === needle[ni]) ni++;
	}
	return ni === needle.length;
}
