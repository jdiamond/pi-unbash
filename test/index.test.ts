import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { parse as parseBash } from "unbash";
import { extractAllCommandsFromAST } from "../src/extract.ts";
import { buildDeniedReason } from "../src/index.ts";

async function loadFreshExtension(tempHome: string) {
  process.env.HOME = tempHome;
  const url = `${pathToFileURL(path.resolve("src/index.ts")).href}?case=${Date.now()}`;
  return (await import(url)).default;
}

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

test("tool_call deny short-circuits before prompting UI", async () => {
  const originalHome = process.env.HOME;
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "pi-unbash-home-"));
  const tempProject = fs.mkdtempSync(
    path.join(os.tmpdir(), "pi-unbash-project-"),
  );

  try {
    fs.mkdirSync(path.join(tempProject, ".pi"), { recursive: true });
    fs.writeFileSync(
      path.join(tempProject, ".pi", "settings.json"),
      JSON.stringify(
        {
          unbash: {
            rules: {
              "git push": "deny",
            },
          },
        },
        null,
        2,
      ),
    );

    const extension = await loadFreshExtension(tempHome);

    let toolCallHandler: ((event: any, ctx: any) => Promise<any>) | undefined;
    const emitted: unknown[] = [];
    const confirmCalls: unknown[] = [];
    const selectCalls: unknown[] = [];

    extension({
      registerCommand() {},
      on(event: string, handler: any) {
        if (event === "tool_call") toolCallHandler = handler;
      },
      events: {
        emit(event: string, payload: unknown) {
          emitted.push({ event, payload });
        },
      },
    } as any);

    assert.ok(
      toolCallHandler,
      "expected extension to register tool_call handler",
    );

    const ctx = {
      hasUI: true,
      cwd: tempProject,
      ui: {
        notify() {},
        async confirm(...args: unknown[]) {
          confirmCalls.push(args);
          return true;
        },
        async select(...args: unknown[]) {
          selectCalls.push(args);
          return "Allow";
        },
      },
    };

    const result = await toolCallHandler!(
      {
        type: "tool_call",
        toolCallId: "tc1",
        toolName: "bash",
        input: { command: "git push origin main" },
      },
      ctx,
    );

    assert.deepEqual(result, {
      block: true,
      reason: 'Denied by project rule "git push": git push origin main',
    });
    assert.equal(confirmCalls.length, 0);
    assert.equal(selectCalls.length, 0);
    assert.deepEqual(emitted, []);
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
  }
});

test("tool_call deny returns in headless mode without prompt UI", async () => {
  const originalHome = process.env.HOME;
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "pi-unbash-home-"));
  const tempProject = fs.mkdtempSync(
    path.join(os.tmpdir(), "pi-unbash-project-"),
  );

  try {
    fs.mkdirSync(path.join(tempProject, ".pi"), { recursive: true });
    fs.writeFileSync(
      path.join(tempProject, ".pi", "settings.json"),
      JSON.stringify(
        {
          unbash: {
            rules: {
              "git push": "deny",
            },
          },
        },
        null,
        2,
      ),
    );

    const extension = await loadFreshExtension(tempHome);

    let toolCallHandler: ((event: any, ctx: any) => Promise<any>) | undefined;
    const confirmCalls: unknown[] = [];
    const selectCalls: unknown[] = [];

    extension({
      registerCommand() {},
      on(event: string, handler: any) {
        if (event === "tool_call") toolCallHandler = handler;
      },
      events: {
        emit() {},
      },
    } as any);

    assert.ok(
      toolCallHandler,
      "expected extension to register tool_call handler",
    );

    const result = await toolCallHandler!(
      {
        type: "tool_call",
        toolCallId: "tc-headless-deny",
        toolName: "bash",
        input: { command: "git push origin main" },
      },
      {
        hasUI: false,
        cwd: tempProject,
        ui: {
          notify() {},
          async confirm(...args: unknown[]) {
            confirmCalls.push(args);
            return true;
          },
          async select(...args: unknown[]) {
            selectCalls.push(args);
            return "Allow";
          },
        },
      },
    );

    assert.deepEqual(result, {
      block: true,
      reason: 'Denied by project rule "git push": git push origin main',
    });
    assert.equal(confirmCalls.length, 0);
    assert.equal(selectCalls.length, 0);
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
  }
});
