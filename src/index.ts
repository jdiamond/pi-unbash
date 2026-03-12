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

interface LoadedConfigResult {
  config: UnbashConfig;
  warning?: string;
}

const DEFAULT_CONFIG: UnbashConfig = {
  enabled: true,
  alwaysAllowed: [
    // Basic read-only utilities
    "cat", "cd", "echo", "find", "grep", "head", "ls", "pwd", "rg", "tail", "true", "wc",
    // Path utilities
    "basename", "dirname", "realpath",
    // System info
    "date", "file", "stat", "uname", "whoami",
    // Tool discovery
    "type", "which",
    // Read-only git
    "git blame", "git branch --show-current", "git diff", "git log", "git show", "git status",
  ],
};

const SAFE_FALLBACK_CONFIG: UnbashConfig = {
  enabled: true,
  alwaysAllowed: [],
};

export function validateLoadedUnbashConfig(input: unknown): LoadedConfigResult {
  if (!input || typeof input !== "object") {
    return {
      config: { ...SAFE_FALLBACK_CONFIG },
      warning: "Invalid unbash config shape; using safe fallback (enabled=true, alwaysAllowed=[]).",
    };
  }

  const cfg = input as Record<string, unknown>;
  const warnings: string[] = [];

  let enabled = SAFE_FALLBACK_CONFIG.enabled;
  if (typeof cfg.enabled === "boolean") {
    enabled = cfg.enabled;
  } else if (cfg.enabled !== undefined) {
    warnings.push("enabled must be a boolean");
  }

  let alwaysAllowed = [...SAFE_FALLBACK_CONFIG.alwaysAllowed];
  if (Array.isArray(cfg.alwaysAllowed)) {
    const validEntries = cfg.alwaysAllowed
      .filter((entry): entry is string => typeof entry === "string")
      .map(entry => entry.trim())
      .filter(entry => entry.length > 0);

    if (validEntries.length !== cfg.alwaysAllowed.length) {
      warnings.push("alwaysAllowed must contain only non-empty strings");
    }

    alwaysAllowed = validEntries;
  } else if (cfg.alwaysAllowed !== undefined) {
    warnings.push("alwaysAllowed must be a string[]");
  }

  if (warnings.length > 0) {
    return {
      config: { enabled, alwaysAllowed },
      warning: `Invalid unbash config fields (${warnings.join("; ")}); using safe values for invalid fields.`,
    };
  }

  return { config: { enabled, alwaysAllowed } };
}

function loadConfig(): LoadedConfigResult {
  if (fs.existsSync(SETTINGS_PATH)) {
    try {
      const data = fs.readFileSync(SETTINGS_PATH, "utf-8");
      const parsed = JSON.parse(data);
      // Fallback to defaults if the "unbash" key doesn't exist yet
      if (parsed.unbash) {
        return validateLoadedUnbashConfig(parsed.unbash);
      }
    } catch (e) {
      return {
        config: { ...SAFE_FALLBACK_CONFIG },
        warning: "Failed to parse settings.json; using safe fallback (enabled=true, alwaysAllowed=[]).",
      };
    }
  }
  return { config: DEFAULT_CONFIG };
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
  const loaded = loadConfig();
  let config = loaded.config;
  let configWarning = loaded.warning;

  if (configWarning) {
    console.warn(`[pi-unbash] ${configWarning}`);
  }

  // Settings Management Command
  pi.registerCommand("unbash", {
    description: "Manage pi-unbash security settings",
    handler: async (args, ctx) => {
      if (configWarning && ctx.hasUI) {
        ctx.ui.notify(`[pi-unbash] ${configWarning}`, "warning");
        configWarning = undefined;
      }

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
      } else if (action === "list") {
        const allowedList = config.alwaysAllowed.length > 0
          ? config.alwaysAllowed.map(command => `- ${command}`).join("\n")
          : "(none)";

        ctx.ui.notify(
          `pi-unbash: ${config.enabled ? "ENABLED" : "DISABLED"}\nAllowed commands:\n${allowedList}`,
          "info"
        );
      } else {
        ctx.ui.notify("Usage: /unbash <allow|deny|toggle|list> [command]", "warning");
      }
    }
  });

  // The core interception hook
  pi.on("tool_call", async (event, ctx) => {
    if (configWarning && ctx.hasUI) {
      ctx.ui.notify(`[pi-unbash] ${configWarning}`, "warning");
      configWarning = undefined;
    }

    if (!config.enabled) return;
    if (!isToolCallEventType("bash", event)) return;

    const rawCmd = event.input.command;
    if (!rawCmd || rawCmd.trim() === "") return;

    let ast;
    try {
      ast = parseBash(rawCmd);
    } catch (e) {
      if (!ctx.hasUI) {
        return { block: true, reason: "Failed to parse bash AST. Command rejected for safety." };
      }

      const confirmed = await ctx.ui.confirm(
        "⚠️ Could Not Parse Command Safely",
        "\nAllow anyway?"
      );

      if (!confirmed) {
        return { block: true, reason: "User denied unparseable command." };
      }

      return;
    }

    if (Array.isArray(ast.errors) && ast.errors.length > 0) {
      if (!ctx.hasUI) {
        return { block: true, reason: "Bash AST contains parse errors. Command rejected for safety." };
      }

      const firstError = ast.errors[0] ?? { message: "unknown parse error", pos: -1 };
      const confirmed = await ctx.ui.confirm(
        "⚠️ Command Parsed With Errors",
        `\nFirst error: ${firstError.message} at ${firstError.pos}\n\nAllow anyway?`
      );

      if (!confirmed) {
        return { block: true, reason: "User denied command with parse errors." };
      }

      return;
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
        reason: `Commands [${unauthorizedCommands.map(c => formatCommand(c, rawCmd)).join(", ")}] require UI confirmation.` 
      };
    }

    // Deduplicate for display
    const uniqueUnauthorized = Array.from(new Set(unauthorizedCommands.map(c => formatCommand(c, rawCmd))));

    const confirmed = await ctx.ui.confirm(
      `⚠️ Unapproved Commands`,
      `\n${uniqueUnauthorized.map(c => `- ${c}`).join("\n")}\n\nProceed?`
    );

    if (!confirmed) {
      return { block: true, reason: "User denied execution." };
    }
  });
}