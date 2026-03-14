import { test } from "node:test";
import assert from "node:assert/strict";
import { parse as parseBash } from "unbash";
import { extractAllCommandsFromAST, getCommandArgs, getCommandName, isCommandAllowed } from "../src/extract.ts";

/** Strip source/node for deepEqual assertions that only care about name/args. */
function summarize(raw: string) {
  return extractAllCommandsFromAST(parseBash(raw), raw).map(cmd => ({
    name: getCommandName(cmd),
    args: getCommandArgs(cmd),
  }));
}

test("extractAllCommandsFromAST", async (t) => {

  await t.test("extracts simple command", () => {
    assert.deepEqual(summarize("ls -la"), [{ name: "ls", args: ["-la"] }]);
  });

  await t.test("extracts multiple commands from AndOr (&&)", () => {
    assert.deepEqual(summarize("git commit -m 'foo' && git push"), [
      { name: "git", args: ["commit", "-m", "foo"] },
      { name: "git", args: ["push"] },
    ]);
  });

  await t.test("extracts commands from pipes (|)", () => {
    assert.deepEqual(summarize("cat file.txt | grep 'foo' | wc -l"), [
      { name: "cat", args: ["file.txt"] },
      { name: "grep", args: ["foo"] },
      { name: "wc", args: ["-l"] },
    ]);
  });

  await t.test("extracts commands from $() subshells", () => {
    assert.deepEqual(summarize("echo $(git status)"), [
      { name: "echo", args: ["$(git status)"] },
      { name: "git", args: ["status"] },
    ]);
  });

  await t.test("extracts commands from backtick subshells", () => {
    assert.deepEqual(summarize("FOO=`rm -rf /` node app.js"), [
      { name: "node", args: ["app.js"] },
      { name: "rm", args: ["-rf", "/"] },
    ]);
  });

  await t.test("extracts from highly nested evil subshells", () => {
    assert.deepEqual(summarize("echo $(cat file.txt | grep $(rm -rf /)) && curl http://evil.com"), [
      { name: "echo", args: ["$(cat file.txt | grep $(rm -rf /))"] },
      { name: "cat", args: ["file.txt"] },
      { name: "grep", args: ["$(rm -rf /)"] },
      { name: "rm", args: ["-rf", "/"] },
      { name: "curl", args: ["http://evil.com"] },
    ]);
  });

  await t.test("extracts commands from subshell grouping", () => {
    assert.deepEqual(summarize("(rm -rf /; echo done)"), [
      { name: "rm", args: ["-rf", "/"] },
      { name: "echo", args: ["done"] },
    ]);
  });

  await t.test("extracts commands from if/then/else", () => {
    assert.deepEqual(summarize("if true; then rm -rf /; else echo safe; fi"), [
      { name: "true", args: [] },
      { name: "rm", args: ["-rf", "/"] },
      { name: "echo", args: ["safe"] },
    ]);
  });

  await t.test("extracts commands from while loop", () => {
    assert.deepEqual(summarize("while true; do curl evil.com; done"), [
      { name: "true", args: [] },
      { name: "curl", args: ["evil.com"] },
    ]);
  });

  await t.test("extracts commands from for loop", () => {
    assert.deepEqual(summarize("for i in 1 2 3; do echo $i; done"), [
      { name: "echo", args: ["$i"] },
    ]);
  });

  await t.test("extracts commands from case statement", () => {
    assert.deepEqual(summarize("case x in y) echo hi;; z) rm -rf /;; esac"), [
      { name: "echo", args: ["hi"] },
      { name: "rm", args: ["-rf", "/"] },
    ]);
  });

  await t.test("extracts commands from function definition", () => {
    assert.deepEqual(summarize("foo() { rm -rf /; }"), [
      { name: "rm", args: ["-rf", "/"] },
    ]);
  });

  await t.test("extracts commands from bare assignment with subshell", () => {
    assert.deepEqual(summarize("FOO=$(rm -rf /)"), [
      { name: "rm", args: ["-rf", "/"] },
    ]);
  });

  await t.test("extracts command with no arguments", () => {
    assert.deepEqual(summarize("pwd"), [{ name: "pwd", args: [] }]);
  });

  await t.test("extracts commands from double-quoted subshells", () => {
    assert.deepEqual(summarize('echo "hello $(rm -rf /)"'), [
      { name: "echo", args: ["hello $(rm -rf /)"] },
      { name: "rm", args: ["-rf", "/"] },
    ]);
  });

  await t.test("does not extract from single-quoted strings", () => {
    assert.deepEqual(summarize("echo 'hello $(rm -rf /)'"), [
      { name: "echo", args: ["hello $(rm -rf /)"] },
    ]);
  });

});

test("isCommandAllowed", async (t) => {
  function cmd(name: string, args: string[]) {
    const raw = [name, ...args].join(" ");
    return extractAllCommandsFromAST(parseBash(raw), raw)[0]!;
  }

  await t.test("allows base command when in allowlist", () => {
    assert.equal(isCommandAllowed(cmd("git", ["status"]), ["git"]), true);
    assert.equal(isCommandAllowed(cmd("git", ["commit", "-m", "msg"]), ["git"]), true);
    assert.equal(isCommandAllowed(cmd("git", []), ["git"]), true);
  });

  await t.test("allows specific subcommand", () => {
    assert.equal(isCommandAllowed(cmd("git", ["status"]), ["git status"]), true);
  });

  await t.test("allows subcommand with extra trailing args", () => {
    assert.equal(isCommandAllowed(cmd("git", ["status", "--short"]), ["git status"]), true);
    assert.equal(isCommandAllowed(cmd("jira", ["issue", "view", "XXX-123"]), ["jira issue view"]), true);
  });

  await t.test("allows subcommand with extra flags interspersed", () => {
    assert.equal(isCommandAllowed(cmd("git", ["branch", "-v", "--show-current"]), ["git branch --show-current"]), true);
  });

  await t.test("blocks other subcommands when only specific one is allowed", () => {
    assert.equal(isCommandAllowed(cmd("git", ["commit", "-m", "msg"]), ["git status"]), false);
    assert.equal(isCommandAllowed(cmd("git", []), ["git status"]), false);
  });

  await t.test("blocks when required tokens are missing", () => {
    assert.equal(isCommandAllowed(cmd("git", ["branch", "-D", "main"]), ["git branch --show-current"]), false);
  });

  await t.test("blocks unknown commands entirely", () => {
    assert.equal(isCommandAllowed(cmd("curl", ["evil.com"]), ["ls", "cat"]), false);
  });

  await t.test("base command allowlist takes precedence over subcommand entries", () => {
    assert.equal(isCommandAllowed(cmd("git", ["push", "--force"]), ["git", "git status"]), true);
  });

  await t.test("multiple subcommands can be allowed independently", () => {
    const allowlist = ["git status", "git log"];
    assert.equal(isCommandAllowed(cmd("git", ["status"]), allowlist), true);
    assert.equal(isCommandAllowed(cmd("git", ["log", "--oneline"]), allowlist), true);
    assert.equal(isCommandAllowed(cmd("git", ["push"]), allowlist), false);
  });

  await t.test("multi-level subcommand matching", () => {
    const allowlist = ["jira issue view", "jira issue list"];
    assert.equal(isCommandAllowed(cmd("jira", ["issue", "view", "PROJ-123"]), allowlist), true);
    assert.equal(isCommandAllowed(cmd("jira", ["issue", "list", "--project", "PROJ"]), allowlist), true);
    assert.equal(isCommandAllowed(cmd("jira", ["issue", "create"]), allowlist), false);
    assert.equal(isCommandAllowed(cmd("jira", ["project", "list"]), allowlist), false);
  });

  await t.test("allows dangerous command only with required flag", () => {
    const allowlist = ["terraform apply --dry-run"];
    assert.equal(isCommandAllowed(cmd("terraform", ["apply", "--dry-run"]), allowlist), true);
    assert.equal(isCommandAllowed(cmd("terraform", ["apply", "-v", "--dry-run"]), allowlist), true);
    assert.equal(isCommandAllowed(cmd("terraform", ["apply"]), allowlist), false);
    assert.equal(isCommandAllowed(cmd("terraform", ["apply", "--force"]), allowlist), false);
  });

});
