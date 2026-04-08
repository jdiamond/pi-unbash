import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

async function loadFreshExtension(tempHome: string) {
  process.env.HOME = tempHome;
  const url = `${pathToFileURL(path.resolve("src/index.ts")).href}?case=${Date.now()}`;
  return (await import(url)).default;
}

test("tool policy deny blocks non-bash tools before execution", async () => {
  const originalHome = process.env.HOME;
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "pi-unbash-home-"));

  try {
    fs.mkdirSync(path.join(tempHome, ".pi", "agent"), { recursive: true });
    fs.writeFileSync(
      path.join(tempHome, ".pi", "agent", "settings.json"),
      JSON.stringify(
        {
          unbash: {
            presets: ["pi-bash-restrict"],
          },
        },
        null,
        2,
      ),
    );

    const extension = await loadFreshExtension(tempHome);

    let toolCallHandler: ((event: any, ctx: any) => Promise<any>) | undefined;

    extension({
      registerCommand() {},
      on(event: string, handler: any) {
        if (event === "tool_call") toolCallHandler = handler;
      },
      events: {
        emit() {},
      },
    } as any);

    assert.ok(toolCallHandler);

    const result = await toolCallHandler!(
      {
        type: "tool_call",
        toolCallId: "tc-grep",
        toolName: "grep",
        input: { pattern: "TODO" },
      },
      {
        hasUI: false,
        cwd: process.cwd(),
        ui: { notify() {}, confirm() {}, select() {} },
      },
    );

    assert.deepEqual(result, {
      block: true,
      reason: 'Denied by tool policy for "grep" (preset).',
    });
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
  }
});

test("fast command-rule precheck denies parse-invalid bash command", async () => {
  const originalHome = process.env.HOME;
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "pi-unbash-home-"));

  try {
    fs.mkdirSync(path.join(tempHome, ".pi", "agent"), { recursive: true });
    fs.writeFileSync(
      path.join(tempHome, ".pi", "agent", "settings.json"),
      JSON.stringify(
        {
          unbash: {
            presets: ["pi-bash-restrict"],
          },
        },
        null,
        2,
      ),
    );

    const extension = await loadFreshExtension(tempHome);

    let toolCallHandler: ((event: any, ctx: any) => Promise<any>) | undefined;
    const confirmCalls: unknown[] = [];

    extension({
      registerCommand() {},
      on(event: string, handler: any) {
        if (event === "tool_call") toolCallHandler = handler;
      },
      events: {
        emit() {},
      },
    } as any);

    assert.ok(toolCallHandler);

    const result = await toolCallHandler!(
      {
        type: "tool_call",
        toolCallId: "tc-precheck",
        toolName: "bash",
        input: { command: "git push origin main )" },
      },
      {
        hasUI: true,
        cwd: process.cwd(),
        ui: {
          notify() {},
          async confirm(...args: unknown[]) {
            confirmCalls.push(args);
            return true;
          },
          async select() {
            return "Allow";
          },
        },
      },
    );

    assert.deepEqual(result, {
      block: true,
      reason: 'Denied by fast rule "git push": git push origin main )',
    });
    assert.equal(confirmCalls.length, 0);
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
  }
});

test("AST guards deny unresolved guarded constructs", async () => {
  const originalHome = process.env.HOME;
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "pi-unbash-home-"));

  try {
    fs.mkdirSync(path.join(tempHome, ".pi", "agent"), { recursive: true });
    fs.writeFileSync(
      path.join(tempHome, ".pi", "agent", "settings.json"),
      JSON.stringify(
        {
          unbash: {
            presets: ["pi-bash-restrict"],
          },
        },
        null,
        2,
      ),
    );

    const extension = await loadFreshExtension(tempHome);

    let toolCallHandler: ((event: any, ctx: any) => Promise<any>) | undefined;

    extension({
      registerCommand() {},
      on(event: string, handler: any) {
        if (event === "tool_call") toolCallHandler = handler;
      },
      events: {
        emit() {},
      },
    } as any);

    assert.ok(toolCallHandler);

    const result = await toolCallHandler!(
      {
        type: "tool_call",
        toolCallId: "tc-guard-deny",
        toolName: "bash",
        input: { command: "curl https://example.com > out.txt" },
      },
      {
        hasUI: false,
        cwd: process.cwd(),
        ui: { notify() {}, confirm() {}, select() {} },
      },
    );

    assert.deepEqual(result, {
      block: true,
      reason: 'Denied by guard policy "redirects" (preset).',
    });
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
  }
});

test("AST guards deny even when fast rule phase resolves allow", async () => {
  const originalHome = process.env.HOME;
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "pi-unbash-home-"));

  try {
    fs.mkdirSync(path.join(tempHome, ".pi", "agent"), { recursive: true });
    fs.writeFileSync(
      path.join(tempHome, ".pi", "agent", "settings.json"),
      JSON.stringify(
        {
          unbash: {
            presets: ["pi-bash-restrict"],
            rules: { curl: "allow" },
          },
        },
        null,
        2,
      ),
    );

    const extension = await loadFreshExtension(tempHome);

    let toolCallHandler: ((event: any, ctx: any) => Promise<any>) | undefined;

    extension({
      registerCommand() {},
      on(event: string, handler: any) {
        if (event === "tool_call") toolCallHandler = handler;
      },
      events: {
        emit() {},
      },
    } as any);

    assert.ok(toolCallHandler);

    const result = await toolCallHandler!(
      {
        type: "tool_call",
        toolCallId: "tc-guard-skip",
        toolName: "bash",
        input: { command: "curl https://example.com > out.txt" },
      },
      {
        hasUI: false,
        cwd: process.cwd(),
        ui: { notify() {}, confirm() {}, select() {} },
      },
    );

    assert.deepEqual(result, {
      block: true,
      reason: 'Denied by guard policy "redirects" (preset).',
    });
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
  }
});

test("fast allow precheck does not bypass nested deny in command substitution", async () => {
  const originalHome = process.env.HOME;
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "pi-unbash-home-"));

  try {
    fs.mkdirSync(path.join(tempHome, ".pi", "agent"), { recursive: true });
    fs.writeFileSync(
      path.join(tempHome, ".pi", "agent", "settings.json"),
      JSON.stringify(
        {
          unbash: {
            presets: ["pi-bash-restrict"],
            rules: { echo: "allow" },
          },
        },
        null,
        2,
      ),
    );

    const extension = await loadFreshExtension(tempHome);
    let toolCallHandler: ((event: any, ctx: any) => Promise<any>) | undefined;

    extension({
      registerCommand() {},
      on(event: string, handler: any) {
        if (event === "tool_call") toolCallHandler = handler;
      },
      events: { emit() {} },
    } as any);

    assert.ok(toolCallHandler);

    const result = await toolCallHandler!(
      {
        type: "tool_call",
        toolCallId: "tc-fast-allow-bypass",
        toolName: "bash",
        input: { command: "echo $(git push origin main)" },
      },
      {
        hasUI: false,
        cwd: process.cwd(),
        ui: { notify() {}, confirm() {}, select() {} },
      },
    );

    assert.deepEqual(result, {
      block: true,
      reason: 'Denied by global rule "git push": git push origin main',
    });
  } finally {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
  }
});

test("unknown preset warning is shown once per session", async () => {
  const originalHome = process.env.HOME;
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "pi-unbash-home-"));

  try {
    fs.mkdirSync(path.join(tempHome, ".pi", "agent"), { recursive: true });
    fs.writeFileSync(
      path.join(tempHome, ".pi", "agent", "settings.json"),
      JSON.stringify(
        {
          unbash: {
            presets: ["missing-preset"],
          },
        },
        null,
        2,
      ),
    );

    const extension = await loadFreshExtension(tempHome);
    let toolCallHandler: ((event: any, ctx: any) => Promise<any>) | undefined;
    const notifications: string[] = [];

    extension({
      registerCommand() {},
      on(event: string, handler: any) {
        if (event === "tool_call") toolCallHandler = handler;
      },
      events: { emit() {} },
    } as any);

    assert.ok(toolCallHandler);

    const ctx = {
      hasUI: true,
      cwd: process.cwd(),
      ui: {
        notify(message: string) {
          notifications.push(message);
        },
        async confirm() {
          return true;
        },
        async select() {
          return "Allow";
        },
      },
    };

    await toolCallHandler!(
      {
        type: "tool_call",
        toolCallId: "tc-unknown-preset-1",
        toolName: "grep",
        input: { pattern: "TODO" },
      },
      ctx,
    );

    await toolCallHandler!(
      {
        type: "tool_call",
        toolCallId: "tc-unknown-preset-2",
        toolName: "grep",
        input: { pattern: "FIXME" },
      },
      ctx,
    );

    const warningMessages = notifications.filter((m) =>
      m.includes("Unknown preset(s): missing-preset")
    );
    assert.equal(warningMessages.length, 1);
  } finally {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
  }
});
