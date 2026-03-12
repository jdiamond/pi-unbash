import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import { parse as parseBash } from "unbash";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { extractAllCommandsFromAST, isCommandAllowed, formatCommand } from "./ast.ts";

// 1. Define configuration storage using pi's native settings.json
const AGENT_DIR = path.join(os.homedir(), ".pi", "agent");
const SETTINGS_PATH = path.join(AGENT_DIR, "settings.json");

interface UnbashConfig {
  enabled: boolean;
  alwaysAllowed: string[];
}

const DEFAULT_CONFIG: UnbashConfig = {
  enabled: true,
  alwaysAllowed: ["ls", "pwd", "cd", "cat", "echo", "grep", "find"],
};

function loadConfig(): UnbashConfig {
  if (fs.existsSync(SETTINGS_PATH)) {
    try {
      const data = fs.readFileSync(SETTINGS_PATH, "utf-8");
      const parsed = JSON.parse(data);
      // Fallback to default if the "unbash" key doesn't exist yet
      if (parsed.unbash) {
        return { ...DEFAULT_CONFIG, ...parsed.unbash };
      }
    } catch (e) {
      console.error("Failed to parse settings.json, using unbash defaults", e);
    }
  }
  return DEFAULT_CONFIG;
}

function saveConfig(config: UnbashConfig) {
  try {
    fs.mkdirSync(AGENT_DIR, { recursive: true });
    
    let settings: any = {};
    if (fs.existsSync(SETTINGS_PATH)) {
      settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf-8"));
    }
    
    // Mutate only our namespace
    settings.unbash = config;
    
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), "utf-8");
  } catch (e) {
    console.error("Failed to save unbash config to settings.json", e);
  }
}

export function parseUnbashArgs(args: string): { action: string; target: string } {
  const trimmed = args.trim();
  if (!trimmed) return { action: "", target: "" };

  const [action = "", ...targetParts] = trimmed.split(/\s+/);
  const target = targetParts.join(" ").trim();

  return { action, target };
}

export default function (pi: ExtensionAPI) {
  let config = loadConfig();

  // Settings Management Command
  pi.registerCommand("unbash", {
    description: "Manage pi-unbash security settings",
    handler: async (args, ctx) => {
      const { action, target } = parseUnbashArgs(args);

      if (action === "allow" && target) {
        if (!config.alwaysAllowed.includes(target)) {
          config.alwaysAllowed.push(target);
          saveConfig(config);
          ctx.ui.notify(`'${target}' added to allowed commands.`, "info");
        } else {
          ctx.ui.notify(`'${target}' is already allowed.`, "info");
        }
      } else if (action === "deny" && target) {
        config.alwaysAllowed = config.alwaysAllowed.filter(c => c !== target);
        saveConfig(config);
        ctx.ui.notify(`'${target}' removed from allowed commands.`, "info");
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
    const unauthorizedCommands = allCommands.filter(cmd => !isCommandAllowed(cmd, config.alwaysAllowed));

    // If every single extracted command is in the allow-list, let it pass silently!
    if (unauthorizedCommands.length === 0) {
      return;
    }

    if (!ctx.hasUI) {
      return { 
        block: true, 
        reason: `Commands [${unauthorizedCommands.map(formatCommand).join(", ")}] require UI confirmation.` 
      };
    }

    // Deduplicate for display
    const uniqueUnauthorized = Array.from(new Set(unauthorizedCommands.map(formatCommand)));

    const confirmed = await ctx.ui.confirm(
      "Security: Unauthorized Command Detected",
      `The agent wants to execute:\n\n${rawCmd}\n\nUnapproved commands: ${uniqueUnauthorized.join(", ")}\n\nAllow this execution?`
    );

    if (!confirmed) {
      return { block: true, reason: "User denied execution." };
    }
  });
}