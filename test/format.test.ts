import { test } from "node:test";
import assert from "node:assert/strict";
import { parse as parseBash } from "unbash";
import { extractAllCommandsFromAST } from "../src/extract.ts";
import { formatCommand } from "../src/format.ts";

test("formatCommand", async (t) => {

  await t.test("re-serializes args as tokens", () => {
    // Without argRanges, falls back to cmd.args values joined with spaces.
    assert.equal(formatCommand({ name: "git", args: ["commit", "-am", "msg"] }, ""), "git commit -am msg");
  });

  await t.test("preserves original quoting via argRanges", () => {
    const raw = `git commit -m "my message"`;
    const [cmd] = extractAllCommandsFromAST(parseBash(raw));
    assert.equal(formatCommand(cmd!, raw), raw);
  });

  await t.test("elides long paths individually, preserving surrounding tokens", () => {
    const raw = "git -C /Users/jdiamond/code/pi-unbash add -A";
    const [cmd] = extractAllCommandsFromAST(parseBash(raw));
    assert.equal(formatCommand(cmd!, raw, { maxLength: 40 }), "git -C /Users/…/pi-unbash add -A");
  });

  await t.test("prefix-truncates long non-path args, preserving command name and flags", () => {
    const raw = `git commit -m "Add a very long commit message that exceeds the token max"`;
    const [cmd] = extractAllCommandsFromAST(parseBash(raw));
    assert.equal(formatCommand(cmd!, raw, { maxLength: 50, argMaxLength: 10 }), `git commit -m "Add a ver…`);
  });

  await t.test("hard-truncates total display at maxLength", () => {
    const cmd = { name: "echo", args: ["aa", "bb", "cc", "dd", "ee", "ff", "gg"] };
    assert.equal(formatCommand(cmd, "", { maxLength: 15 }), "echo aa bb cc …");
  });

  await t.test("replaces newlines with ↵ before elision", () => {
    assert.equal(formatCommand({ name: "python3", args: ["-c", "print('hello\nworld')"] }, ""), "python3 -c print('hello↵world')");
  });

  await t.test("correctly resolves argRanges for commands inside $()", () => {
    const raw = `git reset --soft $(git merge-base main HEAD)`;
    const cmds = extractAllCommandsFromAST(parseBash(raw));
    const inner = cmds.find(c => c.name === "git" && c.args[0] === "merge-base");
    assert.ok(inner, "should extract inner git command");
    assert.equal(formatCommand(inner!, raw), "git merge-base main HEAD");
  });

  await t.test("elides bare relative paths (no leading ./ or /)", () => {
    const raw = "git add packages/tui/src/terminal.ts";
    const [cmd] = extractAllCommandsFromAST(parseBash(raw));
    assert.equal(formatCommand(cmd!, raw, { maxLength: 35 }), "git add packages/tui/…/terminal.ts");
  });

  await t.test("elides quoted paths containing $", () => {
    const raw = `cp "$PROJECT_ROOT/src/routes/\\$page.tsx" dist/`;
    const [cmd] = extractAllCommandsFromAST(parseBash(raw));
    assert.equal(formatCommand(cmd!, raw, { maxLength: 40 }), `cp "$PROJECT_ROOT/src/…/\\$page.tsx" dis…`);
  });

  await t.test("does not treat URLs as paths", () => {
    const raw = `curl https://github.com/owner/repo/blob/main/README.md`;
    const [cmd] = extractAllCommandsFromAST(parseBash(raw));
    assert.equal(formatCommand(cmd!, raw, { argMaxLength: 20 }), "curl https://github.com/owner/repo/blob/main/README.md");
  });

  await t.test("does not treat sentences with a slash as paths", () => {
    const raw = `echo "enable foo/bar and baz qux quux corge"`;
    const [cmd] = extractAllCommandsFromAST(parseBash(raw));
    assert.equal(formatCommand(cmd!, raw), `echo "enable foo/bar and baz qux quux corge"`);
  });

  await t.test("includes heredoc content in display with operator and marker preserved", () => {
    const raw = `node --input-type=module <<'EOF'\nconsole.log("hi");\nEOF`;
    const [cmd] = extractAllCommandsFromAST(parseBash(raw));
    assert.equal(formatCommand(cmd!, raw), `node --input-type=module <<'EOF'↵console.log("hi");↵EOF`);
  });

  await t.test("elides long heredoc content at argMaxLength", () => {
    const raw = `bash <<EOF\n${"x".repeat(100)}\nEOF`;
    const [cmd] = extractAllCommandsFromAST(parseBash(raw));
    assert.equal(formatCommand(cmd!, raw, { maxLength: 50, argMaxLength: 20 }), `bash <<EOF↵${"x".repeat(20)}…`);
  });

  await t.test("preserves <<- operator in heredoc display", () => {
    const raw = `bash <<-EOF\n\techo hi\nEOF`;
    const [cmd] = extractAllCommandsFromAST(parseBash(raw));
    assert.equal(formatCommand(cmd!, raw), `bash <<-EOF↵\techo hi↵EOF`);
  });

  await t.test("does not elide paths that fit within maxLength", () => {
    const raw = "rm /Users/jdiamond/code/pi-unbash/test/ast.test.ts";
    const [cmd] = extractAllCommandsFromAST(parseBash(raw));
    assert.equal(formatCommand(cmd!, raw), raw);
  });

  await t.test("does not truncate short commands", () => {
    assert.equal(formatCommand({ name: "pwd", args: [] }, "pwd"), "pwd");
  });

  await t.test("includes 2>&1 redirect in display", () => {
    const raw = `git rebase -i main --autosquash 2>&1 <<'EOF'\npick abc feat\nEOF`;
    const [cmd] = extractAllCommandsFromAST(parseBash(raw));
    assert.equal(formatCommand(cmd!, raw), `git rebase -i main --autosquash 2>&1 <<'EOF'↵pick abc feat↵EOF`);
  });

  await t.test("includes output redirect in display", () => {
    const raw = `echo hello >out.txt`;
    const [cmd] = extractAllCommandsFromAST(parseBash(raw));
    assert.equal(formatCommand(cmd!, raw), "echo hello >out.txt");
  });

  await t.test("includes input redirect in display", () => {
    const raw = `cat <in.txt`;
    const [cmd] = extractAllCommandsFromAST(parseBash(raw));
    assert.equal(formatCommand(cmd!, raw), "cat <in.txt");
  });

  await t.test("includes stderr redirect in display", () => {
    const raw = `cmd 2>/dev/null`;
    const [cmd] = extractAllCommandsFromAST(parseBash(raw));
    assert.equal(formatCommand(cmd!, raw), "cmd 2>/dev/null");
  });

  await t.test("renders non-heredoc redirects before heredoc in display", () => {
    const raw = `cmd >out.txt <<EOF\nhello\nEOF`;
    const [cmd] = extractAllCommandsFromAST(parseBash(raw));
    assert.equal(formatCommand(cmd!, raw), "cmd >out.txt <<EOF↵hello↵EOF");
  });

});
