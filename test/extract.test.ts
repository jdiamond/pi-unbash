import { test } from "node:test";
import assert from "node:assert/strict";
import { parse as parseBash } from "unbash";
import { extractAllCommandsFromAST, isCommandAllowed } from "../src/extract.ts";

/** Strip pos/end for deepEqual assertions that only care about name/args. */
function stripPositions(cmds: ReturnType<typeof extractAllCommandsFromAST>) {
  return cmds.map(({ name, args }) => ({ name, args }));
}

test("extractAllCommandsFromAST", async (t) => {

  await t.test("extracts simple command", () => {
    const ast = parseBash("ls -la");
    const cmds = extractAllCommandsFromAST(ast);
    assert.deepEqual(stripPositions(cmds), [{ name: "ls", args: ["-la"] }]);
  });

  await t.test("extracts multiple commands from AndOr (&&)", () => {
    const ast = parseBash("git commit -m 'foo' && git push");
    const cmds = extractAllCommandsFromAST(ast);
    assert.deepEqual(stripPositions(cmds), [
      { name: "git", args: ["commit", "-m", "foo"] },
      { name: "git", args: ["push"] },
    ]);
  });

  await t.test("extracts commands from pipes (|)", () => {
    const ast = parseBash("cat file.txt | grep 'foo' | wc -l");
    const cmds = extractAllCommandsFromAST(ast);
    assert.deepEqual(stripPositions(cmds), [
      { name: "cat", args: ["file.txt"] },
      { name: "grep", args: ["foo"] },
      { name: "wc", args: ["-l"] },
    ]);
  });

  await t.test("extracts commands from $() subshells", () => {
    const ast = parseBash("echo $(git status)");
    const cmds = extractAllCommandsFromAST(ast);
    assert.deepEqual(stripPositions(cmds), [
      { name: "echo", args: ["$(git status)"] },
      { name: "git", args: ["status"] },
    ]);
  });

  await t.test("extracts commands from backtick subshells", () => {
    const ast = parseBash("FOO=`rm -rf /` node app.js");
    const cmds = extractAllCommandsFromAST(ast);
    assert.deepEqual(stripPositions(cmds), [
      { name: "node", args: ["app.js"] },
      { name: "rm", args: ["-rf", "/"] },
    ]);
  });

  await t.test("extracts from highly nested evil subshells", () => {
    const ast = parseBash("echo $(cat file.txt | grep $(rm -rf /)) && curl http://evil.com");
    const cmds = extractAllCommandsFromAST(ast);
    assert.deepEqual(stripPositions(cmds), [
      { name: "echo", args: ["$(cat file.txt | grep $(rm -rf /))"] },
      { name: "cat", args: ["file.txt"] },
      { name: "grep", args: ["$(rm -rf /)"] },
      { name: "rm", args: ["-rf", "/"] },
      { name: "curl", args: ["http://evil.com"] },
    ]);
  });

  await t.test("extracts commands from subshell grouping", () => {
    const ast = parseBash("(rm -rf /; echo done)");
    const cmds = extractAllCommandsFromAST(ast);
    assert.deepEqual(stripPositions(cmds), [
      { name: "rm", args: ["-rf", "/"] },
      { name: "echo", args: ["done"] },
    ]);
  });

  await t.test("extracts commands from if/then/else", () => {
    const ast = parseBash("if true; then rm -rf /; else echo safe; fi");
    const cmds = extractAllCommandsFromAST(ast);
    assert.deepEqual(stripPositions(cmds), [
      { name: "true", args: [] },
      { name: "rm", args: ["-rf", "/"] },
      { name: "echo", args: ["safe"] },
    ]);
  });

  await t.test("extracts commands from while loop", () => {
    const ast = parseBash("while true; do curl evil.com; done");
    const cmds = extractAllCommandsFromAST(ast);
    assert.deepEqual(stripPositions(cmds), [
      { name: "true", args: [] },
      { name: "curl", args: ["evil.com"] },
    ]);
  });

  await t.test("extracts commands from for loop", () => {
    const ast = parseBash("for i in 1 2 3; do echo $i; done");
    const cmds = extractAllCommandsFromAST(ast);
    assert.deepEqual(stripPositions(cmds), [
      { name: "echo", args: ["$i"] },
    ]);
  });

  await t.test("extracts commands from case statement", () => {
    const ast = parseBash("case x in y) echo hi;; z) rm -rf /;; esac");
    const cmds = extractAllCommandsFromAST(ast);
    assert.deepEqual(stripPositions(cmds), [
      { name: "echo", args: ["hi"] },
      { name: "rm", args: ["-rf", "/"] },
    ]);
  });

  await t.test("extracts commands from function definition", () => {
    const ast = parseBash("foo() { rm -rf /; }");
    const cmds = extractAllCommandsFromAST(ast);
    assert.deepEqual(stripPositions(cmds), [
      { name: "rm", args: ["-rf", "/"] },
    ]);
  });

  await t.test("extracts commands from bare assignment with subshell", () => {
    const ast = parseBash("FOO=$(rm -rf /)");
    const cmds = extractAllCommandsFromAST(ast);
    assert.deepEqual(stripPositions(cmds), [
      { name: "rm", args: ["-rf", "/"] },
    ]);
  });

  await t.test("extracts command with no arguments", () => {
    const ast = parseBash("pwd");
    const cmds = extractAllCommandsFromAST(ast);
    assert.deepEqual(stripPositions(cmds), [{ name: "pwd", args: [] }]);
  });

  await t.test("extracts commands from double-quoted subshells", () => {
    const ast = parseBash('echo "hello $(rm -rf /)"');
    const cmds = extractAllCommandsFromAST(ast);
    assert.deepEqual(stripPositions(cmds), [
      { name: "echo", args: ["hello $(rm -rf /)"] },
      { name: "rm", args: ["-rf", "/"] },
    ]);
  });

  await t.test("does not extract from single-quoted strings", () => {
    const ast = parseBash("echo 'hello $(rm -rf /)'");
    const cmds = extractAllCommandsFromAST(ast);
    assert.deepEqual(stripPositions(cmds), [
      { name: "echo", args: ["hello $(rm -rf /)"] },
    ]);
  });

});

test("isCommandAllowed", async (t) => {

  await t.test("allows base command when in allowlist", () => {
    assert.equal(isCommandAllowed({ name: "git", args: ["status"] }, ["git"]), true);
    assert.equal(isCommandAllowed({ name: "git", args: ["commit", "-m", "msg"] }, ["git"]), true);
    assert.equal(isCommandAllowed({ name: "git", args: [] }, ["git"]), true);
  });

  await t.test("allows specific subcommand", () => {
    assert.equal(isCommandAllowed({ name: "git", args: ["status"] }, ["git status"]), true);
  });

  await t.test("allows subcommand with extra trailing args", () => {
    assert.equal(isCommandAllowed({ name: "git", args: ["status", "--short"] }, ["git status"]), true);
    assert.equal(isCommandAllowed({ name: "jira", args: ["issue", "view", "XXX-123"] }, ["jira issue view"]), true);
  });

  await t.test("allows subcommand with extra flags interspersed", () => {
    assert.equal(isCommandAllowed({ name: "git", args: ["branch", "-v", "--show-current"] }, ["git branch --show-current"]), true);
  });

  await t.test("blocks other subcommands when only specific one is allowed", () => {
    assert.equal(isCommandAllowed({ name: "git", args: ["commit", "-m", "msg"] }, ["git status"]), false);
    assert.equal(isCommandAllowed({ name: "git", args: [] }, ["git status"]), false);
  });

  await t.test("blocks when required tokens are missing", () => {
    // Allowing "git branch --show-current" should NOT match "git branch -D main"
    assert.equal(isCommandAllowed({ name: "git", args: ["branch", "-D", "main"] }, ["git branch --show-current"]), false);
  });

  await t.test("blocks unknown commands entirely", () => {
    assert.equal(isCommandAllowed({ name: "curl", args: ["evil.com"] }, ["ls", "cat"]), false);
  });

  await t.test("base command allowlist takes precedence over subcommand entries", () => {
    assert.equal(isCommandAllowed({ name: "git", args: ["push", "--force"] }, ["git", "git status"]), true);
  });

  await t.test("multiple subcommands can be allowed independently", () => {
    const allowlist = ["git status", "git log"];
    assert.equal(isCommandAllowed({ name: "git", args: ["status"] }, allowlist), true);
    assert.equal(isCommandAllowed({ name: "git", args: ["log", "--oneline"] }, allowlist), true);
    assert.equal(isCommandAllowed({ name: "git", args: ["push"] }, allowlist), false);
  });

  await t.test("multi-level subcommand matching", () => {
    const allowlist = ["jira issue view", "jira issue list"];
    assert.equal(isCommandAllowed({ name: "jira", args: ["issue", "view", "PROJ-123"] }, allowlist), true);
    assert.equal(isCommandAllowed({ name: "jira", args: ["issue", "list", "--project", "PROJ"] }, allowlist), true);
    assert.equal(isCommandAllowed({ name: "jira", args: ["issue", "create"] }, allowlist), false);
    assert.equal(isCommandAllowed({ name: "jira", args: ["project", "list"] }, allowlist), false);
  });

  await t.test("allows dangerous command only with required flag", () => {
    const allowlist = ["terraform apply --dry-run"];
    assert.equal(isCommandAllowed({ name: "terraform", args: ["apply", "--dry-run"] }, allowlist), true);
    assert.equal(isCommandAllowed({ name: "terraform", args: ["apply", "-v", "--dry-run"] }, allowlist), true);
    assert.equal(isCommandAllowed({ name: "terraform", args: ["apply"] }, allowlist), false);
    assert.equal(isCommandAllowed({ name: "terraform", args: ["apply", "--force"] }, allowlist), false);
  });

});
