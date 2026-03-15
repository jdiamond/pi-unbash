import { test } from "node:test";
import assert from "node:assert/strict";
import { parse as parseBash } from "unbash";
import { extractAllCommandsFromAST, getCommandArgs, getCommandName, resolveCommandAction } from "../src/extract.ts";

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

  await t.test("extracts commands from unquoted heredoc bodies", () => {
    assert.deepEqual(summarize("cat <<EOF\n$(rm -rf /)\nEOF"), [
      { name: "cat", args: [] },
      { name: "rm", args: ["-rf", "/"] },
    ]);
  });

  await t.test("extracts backtick commands from unquoted heredoc bodies", () => {
    assert.deepEqual(summarize("cat <<EOF\n`rm -rf /`\nEOF"), [
      { name: "cat", args: [] },
      { name: "rm", args: ["-rf", "/"] },
    ]);
  });

  await t.test("does not treat plain unquoted heredoc text as commands", () => {
    assert.deepEqual(summarize("cat <<EOF\nrm -rf /\nEOF"), [
      { name: "cat", args: [] },
    ]);
  });

  await t.test("does not extract commands from quoted heredoc bodies", () => {
    assert.deepEqual(summarize("cat <<'EOF'\n$(rm -rf /)\nEOF"), [
      { name: "cat", args: [] },
    ]);
  });

});

test("resolveCommandAction", async (t) => {
  function cmd(name: string, args: string[]) {
    const raw = [name, ...args].join(" ");
    return extractAllCommandsFromAST(parseBash(raw), raw)[0]!;
  }

  await t.test("allows base command when in rules", () => {
    const rules = { "git": "allow" as const };
    assert.equal(resolveCommandAction(cmd("git", ["status"]), rules), "allow");
    assert.equal(resolveCommandAction(cmd("git", ["commit", "-m", "msg"]), rules), "allow");
    assert.equal(resolveCommandAction(cmd("git", []), rules), "allow");
  });

  await t.test("allows specific subcommand", () => {
    assert.equal(resolveCommandAction(cmd("git", ["status"]), { "git status": "allow" }), "allow");
  });

  await t.test("allows subcommand with extra trailing args", () => {
    assert.equal(resolveCommandAction(cmd("git", ["status", "--short"]), { "git status": "allow" }), "allow");
    assert.equal(resolveCommandAction(cmd("jira", ["issue", "view", "XXX-123"]), { "jira issue view": "allow" }), "allow");
  });

  await t.test("allows subcommand with extra flags interspersed", () => {
    assert.equal(resolveCommandAction(cmd("git", ["branch", "-v", "--show-current"]), { "git branch --show-current": "allow" }), "allow");
  });

  await t.test("asks for other subcommands when only specific one is allowed", () => {
    const rules = { "git status": "allow" as const };
    assert.equal(resolveCommandAction(cmd("git", ["commit", "-m", "msg"]), rules), "ask");
    assert.equal(resolveCommandAction(cmd("git", []), rules), "ask");
  });

  await t.test("asks when required tokens are missing", () => {
    assert.equal(resolveCommandAction(cmd("git", ["branch", "-D", "main"]), { "git branch --show-current": "allow" }), "ask");
  });

  await t.test("asks for unknown commands", () => {
    assert.equal(resolveCommandAction(cmd("curl", ["evil.com"]), { "ls": "allow", "cat": "allow" }), "ask");
  });

  await t.test("last match wins — base rule after subcommand rule overrides it", () => {
    const rules = { "git status": "ask" as const, "git": "allow" as const };
    assert.equal(resolveCommandAction(cmd("git", ["status"]), rules), "allow");
  });

  await t.test("last match wins — subcommand rule after base rule overrides it", () => {
    const rules = { "git": "allow" as const, "git status": "ask" as const };
    assert.equal(resolveCommandAction(cmd("git", ["status"]), rules), "ask");
  });

  await t.test("* matches any command", () => {
    assert.equal(resolveCommandAction(cmd("curl", ["evil.com"]), { "*": "allow" }), "allow");
    assert.equal(resolveCommandAction(cmd("rm", ["-rf", "/"]), { "*": "allow" }), "allow");
  });

  await t.test("* is overridden by later specific rule", () => {
    const rules = { "*": "allow" as const, "curl": "ask" as const };
    assert.equal(resolveCommandAction(cmd("curl", ["evil.com"]), rules), "ask");
    assert.equal(resolveCommandAction(cmd("ls", []), rules), "allow");
  });

  await t.test("specific rule is overridden by later *", () => {
    const rules = { "curl": "ask" as const, "*": "allow" as const };
    assert.equal(resolveCommandAction(cmd("curl", ["evil.com"]), rules), "allow");
  });

  await t.test("returns ask when no rule matches", () => {
    assert.equal(resolveCommandAction(cmd("curl", ["evil.com"]), {}), "ask");
  });

  await t.test("multiple subcommands can be allowed independently", () => {
    const rules = { "git status": "allow" as const, "git log": "allow" as const };
    assert.equal(resolveCommandAction(cmd("git", ["status"]), rules), "allow");
    assert.equal(resolveCommandAction(cmd("git", ["log", "--oneline"]), rules), "allow");
    assert.equal(resolveCommandAction(cmd("git", ["push"]), rules), "ask");
  });

  await t.test("multi-level subcommand matching", () => {
    const rules = { "jira issue view": "allow" as const, "jira issue list": "allow" as const };
    assert.equal(resolveCommandAction(cmd("jira", ["issue", "view", "PROJ-123"]), rules), "allow");
    assert.equal(resolveCommandAction(cmd("jira", ["issue", "list", "--project", "PROJ"]), rules), "allow");
    assert.equal(resolveCommandAction(cmd("jira", ["issue", "create"]), rules), "ask");
    assert.equal(resolveCommandAction(cmd("jira", ["project", "list"]), rules), "ask");
  });

  await t.test("allows dangerous command only with required flag", () => {
    const rules = { "terraform apply --dry-run": "allow" as const };
    assert.equal(resolveCommandAction(cmd("terraform", ["apply", "--dry-run"]), rules), "allow");
    assert.equal(resolveCommandAction(cmd("terraform", ["apply", "-v", "--dry-run"]), rules), "allow");
    assert.equal(resolveCommandAction(cmd("terraform", ["apply"]), rules), "ask");
    assert.equal(resolveCommandAction(cmd("terraform", ["apply", "--force"]), rules), "ask");
  });

});
