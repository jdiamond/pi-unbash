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

test("/unbash preset add|remove|clear persists global preset ordering", async () => {
  const originalHome = process.env.HOME;
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "pi-unbash-home-"));

  try {
    fs.mkdirSync(path.join(tempHome, ".pi", "agent"), { recursive: true });
    fs.writeFileSync(
      path.join(tempHome, ".pi", "agent", "settings.json"),
      JSON.stringify({ unbash: { presets: ["destructive-calls", "custom", "custom"] } }, null, 2),
    );

    const extension = await loadFreshExtension(tempHome);

    let commandHandler: ((args: string, ctx: any) => Promise<void>) | undefined;

    extension({
      registerCommand(name: string, command: any) {
        if (name === "unbash") {
          commandHandler = command.handler;
        }
      },
      on() {},
      events: { emit() {} },
    } as any);

    assert.ok(commandHandler);

    const notifications: string[] = [];
    const ctx = {
      hasUI: true,
      cwd: process.cwd(),
      ui: {
        notify(message: string) {
          notifications.push(message);
        },
      },
    };

    await commandHandler!("preset add pi-bash-restrict", ctx);
    await commandHandler!("preset remove custom", ctx);
    await commandHandler!("preset clear", ctx);

    const settings = JSON.parse(
      fs.readFileSync(path.join(tempHome, ".pi", "agent", "settings.json"), "utf-8"),
    );

    assert.deepEqual(settings.unbash.presets, undefined);
    assert.ok(notifications.some((message) => message.includes("added")));
    assert.ok(notifications.some((message) => message.includes("removed")));
    assert.ok(notifications.some((message) => message.includes("cleared")));
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
  }
});

test("/unbash preset add does not duplicate an existing preset", async () => {
  const originalHome = process.env.HOME;
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "pi-unbash-home-"));

  try {
    fs.mkdirSync(path.join(tempHome, ".pi", "agent"), { recursive: true });
    fs.writeFileSync(
      path.join(tempHome, ".pi", "agent", "settings.json"),
      JSON.stringify({ unbash: { presets: ["destructive-calls"] } }, null, 2),
    );

    const extension = await loadFreshExtension(tempHome);

    let commandHandler: ((args: string, ctx: any) => Promise<void>) | undefined;

    extension({
      registerCommand(name: string, command: any) {
        if (name === "unbash") commandHandler = command.handler;
      },
      on() {},
      events: { emit() {} },
    } as any);

    assert.ok(commandHandler);

    await commandHandler!("preset add destructive-calls", {
      hasUI: true,
      cwd: process.cwd(),
      ui: { notify() {} },
    });

    const settings = JSON.parse(
      fs.readFileSync(path.join(tempHome, ".pi", "agent", "settings.json"), "utf-8"),
    );

    assert.deepEqual(settings.unbash.presets, ["destructive-calls"]);
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
  }
});

test("/unbash preset list shows built-ins, active order, and unknown names", async () => {
  const originalHome = process.env.HOME;
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "pi-unbash-home-"));
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), "pi-unbash-project-"));

  try {
    fs.mkdirSync(path.join(tempHome, ".pi", "agent"), { recursive: true });
    fs.writeFileSync(
      path.join(tempHome, ".pi", "agent", "settings.json"),
      JSON.stringify({ unbash: { presets: ["destructive-calls", "missing"] } }, null, 2),
    );

    fs.mkdirSync(path.join(tempProject, ".pi"), { recursive: true });
    fs.writeFileSync(
      path.join(tempProject, ".pi", "settings.json"),
      JSON.stringify(
        {
          unbash: {
            presets: ["pi-bash-restrict"],
            customPresets: {
              "my-team": {
                rules: { git: "ask" },
              },
            },
          },
        },
        null,
        2,
      ),
    );

    const extension = await loadFreshExtension(tempHome);

    let commandHandler: ((args: string, ctx: any) => Promise<void>) | undefined;

    extension({
      registerCommand(name: string, command: any) {
        if (name === "unbash") commandHandler = command.handler;
      },
      on() {},
      events: { emit() {} },
    } as any);

    assert.ok(commandHandler);

    const notifications: string[] = [];
    await commandHandler!("preset list", {
      hasUI: true,
      cwd: tempProject,
      ui: {
        notify(message: string) {
          notifications.push(message);
        },
      },
    });

    const message = notifications.find((entry) => entry.includes("Built-in presets"));
    assert.ok(message);
    assert.ok(message?.includes("destructive-calls"));
    assert.ok(message?.includes("pi-bash-restrict"));
    assert.ok(message?.includes("Active global preset order"));
    assert.ok(message?.includes("Unknown active presets"));
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
  }
});
