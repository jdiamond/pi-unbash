import { test } from "node:test";
import assert from "node:assert/strict";
import { parse as parseBash } from "unbash";
import { extractAllCommandsFromAST } from "../extensions/ast.ts";

test("extractAllCommandsFromAST", async (t) => {

  await t.test("extracts simple command", () => {
    const ast = parseBash("ls -la");
    const cmds = extractAllCommandsFromAST(ast);
    assert.deepEqual(cmds, ["ls"]);
  });

  await t.test("extracts multiple commands from AndOr (&&)", () => {
    const ast = parseBash("git commit -m 'foo' && git push");
    const cmds = extractAllCommandsFromAST(ast);
    assert.deepEqual(cmds, ["git", "git"]);
  });

  await t.test("extracts commands from pipes (|)", () => {
    const ast = parseBash("cat file.txt | grep 'foo' | wc -l");
    const cmds = extractAllCommandsFromAST(ast);
    assert.deepEqual(cmds, ["cat", "grep", "wc"]);
  });

  await t.test("extracts commands from $() subshells", () => {
    const ast = parseBash("echo $(git status)");
    const cmds = extractAllCommandsFromAST(ast);
    assert.deepEqual(cmds, ["echo", "git"]);
  });

  await t.test("extracts commands from backtick subshells", () => {
    const ast = parseBash("FOO=`rm -rf /` node app.js");
    // Unbash treats variable assignments correctly, but for safety our traversal
    // will still dig out the command inside the backticks.
    const cmds = extractAllCommandsFromAST(ast);
    assert.deepEqual(cmds, ["node", "rm"]);
  });

  await t.test("extracts from highly nested evil subshells", () => {
    const ast = parseBash("echo $(cat file.txt | grep $(rm -rf /)) && curl http://evil.com");
    const cmds = extractAllCommandsFromAST(ast);
    
    // It should find all 5 base commands
    assert.deepEqual(cmds, ["echo", "cat", "grep", "rm", "curl"]);
  });

});