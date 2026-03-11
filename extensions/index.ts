import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import { parse as parseBash } from "unbash";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { extractAllCommandsFromAST } from "./ast.ts";

// 1. Define configuration storage
const CONFIG_DIR = path.join(os.homedir(), ".pi", "agent", "extensions");
const CONFIG_PATH = path.join(CONFIG_DIR, "pi-unbash.json");

interface UnbashConfig {
  enabled: boolean;
  alwaysAllowed: string[];
}

const DEFAULT_CONFIG: UnbashConfig = {
  enabled: true,
  alwaysAllowed: ["ls", "pwd", "cat", "echo", "grep", "find"],
};

function loadConfig(): UnbashConfig {
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const data = fs.readFileSync(CONFIG_PATH, "utf-8");
      return { ...DEFAULT_CONFIG, ...JSON.parse(data) };
    } catch (e) {
      console.error("Failed to parse config, using defaults", e);
    }
  }
  return DEFAULT_CONFIG;
}

function saveConfig(config: UnbashConfig) {
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
  } catch (e) {
    console.error("Failed to save config", e);
  }
}

export default function (pi: ExtensionAPI) {
  let config = loadConfig();

  // Settings Management Command
  pi.registerCommand("unbash", {
    description: "Manage pi-unbash security settings",
    handler: async (args, ctx) => {
      const parts = args.trim().split(" ");
      const action = parts[0];
      const target = parts[1];

      if (action === "allow" && target) {
        if (!config.alwaysAllowed.includes(target)) {
          config.alwaysAllowed.push(target);
          saveConfig(config);
          ctx.ui.notify(`'${target}' added to allowed commands.`, "success");
        } else {
          ctx.ui.notify(`'${target}' is already allowed.`, "info");
        }
      } else if (action === "deny" && target) {
        config.alwaysAllowed = config.alwaysAllowed.filter(c => c !== target);
        saveConfig(config);
        ctx.ui.notify(`'${target}' removed from allowed commands.`, "success");
      } else if (action === "toggle") {
        config.enabled = !config.enabled;
        saveConfig(config);
        ctx.ui.notify(`pi-unbash is now ${config.enabled ? "ENABLED" : "DISABLED"}`, "info");
      } else {
        ctx.ui.notify("Usage: /unbash <allow|deny|toggle> [command]", "warning");
      }
    }
  });

  // The core interception hook
  pi.on("tool_call", async (event, ctx) => {
    if (!config.enabled) return;
    if (!isToolCallEventType("bash", event)) return;

    const rawCmd = event.input.command;
    if (!rawCmd || rawCmd.trim() === "") return;

    let ast;
    try {
      ast = parseBash(rawCmd);
    } catch (e) {
      return { block: true, reason: `Failed to parse bash AST. Command rejected for safety.` };
    }

    // Extract EVERY command in the tree (including pipes, gates, subshells)
    const allCommands = extractAllCommandsFromAST(ast);
    
    if (allCommands.length === 0) return;

    // Find all commands that are NOT in the allow list
    const unauthorizedCommands = allCommands.filter(cmd => !config.alwaysAllowed.includes(cmd));

    // If every single extracted command is in the allow-list, let it pass silently!
    if (unauthorizedCommands.length === 0) {
      return;
    }

    if (!ctx.hasUI) {
      return { 
        block: true, 
        reason: `Commands [${unauthorizedCommands.join(", ")}] require UI confirmation.` 
      };
    }

    // Deduplicate for display
    const uniqueUnauthorized = Array.from(new Set(unauthorizedCommands));

    const confirmed = await ctx.ui.confirm(
      "Security: Unauthorized Command Detected",
      `The agent wants to execute:\n\n${rawCmd}\n\nUnapproved Base Commands found: ${uniqueUnauthorized.join(", ")}\n\nAllow this execution?`
    );

    if (!confirmed) {
      return { block: true, reason: "User denied execution." };
    }
  });
}