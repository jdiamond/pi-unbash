import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import { parse as parseBash } from "unbash";
import { DEFAULT_RULES } from "./defaults.ts";
import { extractAllCommandsFromAST } from "./extract.ts";
import {
  FORMAT_COMMAND_DEFAULT_ARG_MAX_LENGTH,
  FORMAT_COMMAND_DEFAULT_MAX_LENGTH,
  formatCommand,
} from "./format.ts";
import { buildApprovalPrompt } from "./prompt.ts";
import { extractTopLevelFastCommands, isFastAllowSafe } from "./fast.ts";
import { detectTriggeredGuards, findDeniedGuard } from "./guards.ts";
import {
  BUILTIN_PRESETS,
  buildEffectivePresetPolicies,
  buildPresetContext,
  type PolicyAction,
  type PersistentRuleAction,
  type UnbashPreset,
} from "./presets.ts";
import {
  getCommandName,
  type RuleDecision,
  type RuleLayers,
  resolveCommandDecision,
  resolveCommandDecisionFromTokens,
} from "./resolve.ts";

const AGENT_DIR = path.join(os.homedir(), ".pi", "agent");
const SETTINGS_PATH = path.join(AGENT_DIR, "settings.json");

type SessionRuleAction = "allow";

interface UnbashConfig {
  enabled: boolean;
  presets: string[];
  customPresets: Record<string, UnbashPreset>;
  rules: Record<string, PersistentRuleAction>;
  commandDisplayMaxLength: number;
  commandDisplayArgMaxLength: number;
}

interface LoadedConfigResult {
  config: UnbashConfig;
  warning?: string;
}

const DEFAULT_CONFIG: UnbashConfig = {
  enabled: true,
  presets: [],
  customPresets: {},
  rules: {},
  commandDisplayMaxLength: FORMAT_COMMAND_DEFAULT_MAX_LENGTH,
  commandDisplayArgMaxLength: FORMAT_COMMAND_DEFAULT_ARG_MAX_LENGTH,
};

const SAFE_FALLBACK_CONFIG: UnbashConfig = {
  enabled: true,
  presets: [],
  customPresets: {},
  rules: {},
  commandDisplayMaxLength: FORMAT_COMMAND_DEFAULT_MAX_LENGTH,
  commandDisplayArgMaxLength: FORMAT_COMMAND_DEFAULT_ARG_MAX_LENGTH,
};

/** Merge default, preset, explicit, and session rules. Later layers win. */
export function buildEffectiveRules(
  userRules: Record<string, PersistentRuleAction>,
  projectRules: Record<string, PersistentRuleAction>,
  sessionRules: Record<string, SessionRuleAction>,
  options?: {
    globalPresetRules?: Record<string, PersistentRuleAction>;
    projectPresetRules?: Record<string, PersistentRuleAction>;
  },
): Record<string, PersistentRuleAction> {
  return {
    ...DEFAULT_RULES,
    ...(options?.globalPresetRules ?? {}),
    ...userRules,
    ...(options?.projectPresetRules ?? {}),
    ...projectRules,
    ...sessionRules,
  };
}

export function buildRuleLayers(
  userRules: Record<string, PersistentRuleAction>,
  projectRules: Record<string, PersistentRuleAction>,
  sessionRules: Record<string, SessionRuleAction>,
  options?: {
    globalPresetRules?: Record<string, PersistentRuleAction>;
    projectPresetRules?: Record<string, PersistentRuleAction>;
  },
): RuleLayers {
  return {
    default: DEFAULT_RULES,
    global: { ...(options?.globalPresetRules ?? {}), ...userRules },
    project: { ...(options?.projectPresetRules ?? {}), ...projectRules },
    session: sessionRules,
  };
}

export function resolvePresetPoliciesForConfigs(
  globalConfig: Pick<UnbashConfig, "presets" | "customPresets">,
  projectConfig: Pick<UnbashConfig, "presets" | "customPresets">,
): {
  globalPresetRules: Record<string, PersistentRuleAction>;
  projectPresetRules: Record<string, PersistentRuleAction>;
  toolPolicies: Record<string, PolicyAction>;
  guards: Record<string, PolicyAction>;
  unknownPresetNames: string[];
} {
  const context = buildPresetContext(globalConfig, projectConfig);
  const globalPresetPolicies = buildEffectivePresetPolicies({
    activePresets: globalConfig.presets,
    customPresets: context.customPresets,
  });
  const projectPresetPolicies = buildEffectivePresetPolicies({
    activePresets: projectConfig.presets,
    customPresets: context.customPresets,
  });

  return {
    globalPresetRules: globalPresetPolicies.rules,
    projectPresetRules: projectPresetPolicies.rules,
    toolPolicies: {
      ...globalPresetPolicies.toolPolicies,
      ...projectPresetPolicies.toolPolicies,
    },
    guards: {
      ...globalPresetPolicies.guards,
      ...projectPresetPolicies.guards,
    },
    unknownPresetNames: [
      ...globalPresetPolicies.unknownPresetNames,
      ...projectPresetPolicies.unknownPresetNames,
    ],
  };
}

export function buildDeniedReason(
  command: Parameters<typeof formatCommand>[0],
  decision: RuleDecision,
  options: { maxLength?: number; argMaxLength?: number },
): string {
  const preview = formatCommand(command, options);
  const layer = decision.layer ?? "unknown";
  const pattern = decision.pattern ?? "*";
  return `Denied by ${layer} rule "${pattern}": ${preview}`;
}

/** Load project-level unbash config from .pi/settings.json in the given directory. */
function loadProjectConfig(cwd: string): LoadedConfigResult | null {
  const projectSettingsPath = path.join(cwd, ".pi", "settings.json");
  if (!fs.existsSync(projectSettingsPath)) {
    return null;
  }
  try {
    const data = fs.readFileSync(projectSettingsPath, "utf-8");
    const parsed = JSON.parse(data);
    const result = getUnbashConfigFromSettings(parsed);
    return result;
  } catch (e) {
    return {
      config: { ...SAFE_FALLBACK_CONFIG },
      warning:
        "Failed to parse project .pi/settings.json; using safe fallback.",
    };
  }
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parsePresetNames(input: unknown): {
  value: string[];
  invalid: boolean;
} {
  if (input === undefined) return { value: [], invalid: false };
  if (!Array.isArray(input)) return { value: [], invalid: true };

  const value: string[] = [];
  let invalid = false;
  for (const name of input) {
    if (typeof name === "string" && name.trim().length > 0) {
      value.push(name.trim());
    } else {
      invalid = true;
    }
  }

  return { value, invalid };
}

function parsePolicyMap(
  input: unknown,
): { value: Record<string, PolicyAction>; invalid: boolean } {
  if (!isObjectRecord(input)) return { value: {}, invalid: true };

  const value: Record<string, PolicyAction> = {};
  let invalid = false;
  for (const [key, action] of Object.entries(input)) {
    if (
      typeof key === "string" &&
      key.trim().length > 0 &&
      (action === "allow" || action === "deny")
    ) {
      value[key] = action;
    } else {
      invalid = true;
    }
  }

  return { value, invalid };
}

function parseRuleMap(
  input: unknown,
): { value: Record<string, PersistentRuleAction>; invalid: boolean } {
  if (!isObjectRecord(input)) return { value: {}, invalid: true };

  const value: Record<string, PersistentRuleAction> = {};
  let invalid = false;
  for (const [key, action] of Object.entries(input)) {
    if (
      typeof key === "string" &&
      key.trim().length > 0 &&
      (action === "allow" || action === "ask" || action === "deny")
    ) {
      value[key] = action;
    } else {
      invalid = true;
    }
  }

  return { value, invalid };
}

function parseCustomPresets(input: unknown): {
  value: Record<string, UnbashPreset>;
  invalid: boolean;
} {
  if (input === undefined) return { value: {}, invalid: false };
  if (!isObjectRecord(input)) return { value: {}, invalid: true };

  const value: Record<string, UnbashPreset> = {};
  let invalid = false;

  for (const [presetName, presetValue] of Object.entries(input)) {
    if (typeof presetName !== "string" || presetName.trim().length === 0) {
      invalid = true;
      continue;
    }

    if (!isObjectRecord(presetValue)) {
      invalid = true;
      continue;
    }

    const preset: UnbashPreset = {};

    if (Object.hasOwn(presetValue, "rules")) {
      const parsed = parseRuleMap(presetValue.rules);
      if (parsed.invalid) invalid = true;
      if (Object.keys(parsed.value).length > 0) {
        preset.rules = parsed.value;
      }
    }

    if (Object.hasOwn(presetValue, "toolPolicies")) {
      const parsed = parsePolicyMap(presetValue.toolPolicies);
      if (parsed.invalid) invalid = true;
      if (Object.keys(parsed.value).length > 0) {
        preset.toolPolicies = parsed.value;
      }
    }

    if (Object.hasOwn(presetValue, "guards")) {
      const parsed = parsePolicyMap(presetValue.guards);
      if (parsed.invalid) invalid = true;
      if (Object.keys(parsed.value).length > 0) {
        preset.guards = parsed.value;
      }
    }

    value[presetName] = preset;
  }

  return { value, invalid };
}

export function validateLoadedUnbashConfig(input: unknown): LoadedConfigResult {
  if (!input || typeof input !== "object") {
    return {
      config: { ...SAFE_FALLBACK_CONFIG },
      warning:
        "Invalid unbash config shape; using safe fallback (enabled=true, rules={}).",
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

  const parsedPresets = parsePresetNames(cfg.presets);
  if (parsedPresets.invalid) {
    warnings.push('presets must be an array of non-empty strings');
  }

  const parsedCustomPresets = parseCustomPresets(cfg.customPresets);
  if (parsedCustomPresets.invalid) {
    warnings.push("customPresets contains invalid entries");
  }

  let rules: Record<string, PersistentRuleAction> = {};
  if (cfg.rules !== undefined) {
    const parsedRules = parseRuleMap(cfg.rules);
    if (parsedRules.invalid) {
      warnings.push(
        'rules must be an object mapping non-empty strings to "allow", "ask", or "deny"',
      );
    }
    rules = parsedRules.value;
  }

  let commandDisplayMaxLength = SAFE_FALLBACK_CONFIG.commandDisplayMaxLength;
  if (
    typeof cfg.commandDisplayMaxLength === "number" &&
    cfg.commandDisplayMaxLength > 0
  ) {
    commandDisplayMaxLength = cfg.commandDisplayMaxLength;
  } else if (cfg.commandDisplayMaxLength !== undefined) {
    warnings.push("commandDisplayMaxLength must be a positive number");
  }

  let commandDisplayArgMaxLength =
    SAFE_FALLBACK_CONFIG.commandDisplayArgMaxLength;
  if (
    typeof cfg.commandDisplayArgMaxLength === "number" &&
    cfg.commandDisplayArgMaxLength > 0
  ) {
    commandDisplayArgMaxLength = cfg.commandDisplayArgMaxLength;
  } else if (cfg.commandDisplayArgMaxLength !== undefined) {
    warnings.push("commandDisplayArgMaxLength must be a positive number");
  }

  if (warnings.length > 0) {
    return {
      config: {
        enabled,
        presets: parsedPresets.value,
        customPresets: parsedCustomPresets.value,
        rules,
        commandDisplayMaxLength,
        commandDisplayArgMaxLength,
      },
      warning: `Invalid unbash config fields (${warnings.join("; ")}); using safe values for invalid fields.`,
    };
  }

  return {
    config: {
      enabled,
      presets: parsedPresets.value,
      customPresets: parsedCustomPresets.value,
      rules,
      commandDisplayMaxLength,
      commandDisplayArgMaxLength,
    },
  };
}

export function getUnbashConfigFromSettings(
  input: unknown,
): LoadedConfigResult {
  if (!input || typeof input !== "object") {
    return { config: DEFAULT_CONFIG };
  }

  const settings = input as Record<string, unknown>;

  if (!Object.hasOwn(settings, "unbash")) {
    return { config: DEFAULT_CONFIG };
  }

  return validateLoadedUnbashConfig(settings.unbash);
}

function loadConfig(): LoadedConfigResult {
  if (fs.existsSync(SETTINGS_PATH)) {
    try {
      const data = fs.readFileSync(SETTINGS_PATH, "utf-8");
      const parsed = JSON.parse(data);
      return getUnbashConfigFromSettings(parsed);
    } catch (e) {
      return {
        config: { ...SAFE_FALLBACK_CONFIG },
        warning:
          "Failed to parse settings.json; using safe fallback (enabled=true, rules={}).",
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

    // Only save explicit user config, never merged effective policy
    settings.unbash = {
      enabled: config.enabled,
      rules: config.rules,
      ...(config.presets.length > 0 && {
        presets: config.presets,
      }),
      ...(Object.keys(config.customPresets).length > 0 && {
        customPresets: config.customPresets,
      }),
      ...(config.commandDisplayMaxLength !==
        FORMAT_COMMAND_DEFAULT_MAX_LENGTH && {
        commandDisplayMaxLength: config.commandDisplayMaxLength,
      }),
      ...(config.commandDisplayArgMaxLength !==
        FORMAT_COMMAND_DEFAULT_ARG_MAX_LENGTH && {
        commandDisplayArgMaxLength: config.commandDisplayArgMaxLength,
      }),
    };

    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), "utf-8");
  } catch (e) {
    console.error("Failed to save unbash config to settings.json", e);
  }
}

export function parseUnbashArgs(args: string): {
  action: string;
  target: string;
} {
  const trimmed = args.trim();
  if (!trimmed) return { action: "", target: "" };

  const [action = "", ...targetParts] = trimmed.split(/\s+/);
  const target = targetParts.join(" ").trim();

  return { action, target };
}

export function upsertRuleAtEnd<T extends string>(
  rules: Record<string, T>,
  pattern: string,
  action: T,
): Record<string, T> {
  const next = { ...rules };
  delete next[pattern];
  next[pattern] = action;
  return next;
}

function buildPresetListMessage(
  config: UnbashConfig,
  projectConfig: UnbashConfig,
  sessionRules: Record<string, SessionRuleAction>,
): string {
  const builtinNames = Object.keys(BUILTIN_PRESETS).sort();
  const customNames = Object.keys({
    ...config.customPresets,
    ...projectConfig.customPresets,
  }).sort();

  const resolved = resolvePresetPoliciesForConfigs(config, projectConfig);

  const activeGlobal = config.presets.length > 0
    ? config.presets.map((name, i) => `  ${i + 1}. ${name}`).join("\n")
    : "  (none)";
  const activeProject = projectConfig.presets.length > 0
    ? projectConfig.presets.map((name, i) => `  ${i + 1}. ${name}`).join("\n")
    : "  (none)";

  const userRules = Object.entries(config.rules).length > 0
    ? Object.entries(config.rules).map(([pattern, act]) => `  ${pattern}: ${act}`).join("\n")
    : "  (none)";
  const projectRules = Object.entries(projectConfig.rules).length > 0
    ? Object.entries(projectConfig.rules)
        .map(([pattern, act]) => `  ${pattern}: ${act}`)
        .join("\n")
    : "  (none)";
  const sessionRuleLines = Object.entries(sessionRules).length > 0
    ? Object.entries(sessionRules).map(([pattern, act]) => `  ${pattern}: ${act}`).join("\n")
    : "  (none)";

  const unknown = resolved.unknownPresetNames.length > 0
    ? `\n\nUnknown active presets:\n${resolved.unknownPresetNames.map((name) => `  - ${name}`).join("\n")}`
    : "";

  return [
    `Built-in presets:\n${builtinNames.map((name) => `  - ${name}`).join("\n")}`,
    `Available custom presets:\n${customNames.length > 0 ? customNames.map((name) => `  - ${name}`).join("\n") : "  (none)"}`,
    `Active global preset order:\n${activeGlobal}`,
    `Active project preset order:\n${activeProject}`,
    `Explicit global rules:\n${userRules}`,
    `Explicit project rules:\n${projectRules}`,
    `Session rules:\n${sessionRuleLines}`,
  ].join("\n\n") + unknown;
}

function parsePresetSubcommand(input: string): { action: string; name: string } {
  const trimmed = input.trim();
  if (!trimmed) return { action: "", name: "" };

  const [action = "", ...rest] = trimmed.split(/\s+/);
  return { action, name: rest.join(" ").trim() };
}

export default function (pi: ExtensionAPI) {
  const loaded = loadConfig();
  const config = loaded.config;
  let configWarning = loaded.warning;
  const sessionRules: Record<string, SessionRuleAction> = {};
  const warnedUnknownPresets = new Set<string>();

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

      if ((action === "allow" || action === "deny") && target) {
        config.rules = upsertRuleAtEnd(config.rules, target, action);
        saveConfig(config);
        ctx.ui.notify(`'${target}' set to ${action}.`, "info");
      } else if (action === "toggle") {
        config.enabled = !config.enabled;
        saveConfig(config);
        ctx.ui.notify(
          `pi-unbash is now ${config.enabled ? "ENABLED" : "DISABLED"}`,
          "info",
        );
      } else if (action === "list") {
        const defaultLines = Object.entries(DEFAULT_RULES)
          .map(([pattern, act]) => `  ${pattern}: ${act}`)
          .join("\n");

        const userLines =
          Object.entries(config.rules).length > 0
            ? Object.entries(config.rules)
                .map(([pattern, act]) => `  ${pattern}: ${act}`)
                .join("\n")
            : "  (none)";

        const projectResult = loadProjectConfig(ctx.cwd);
        const projectRules = projectResult?.config.rules ?? {};
        const projectLines =
          Object.entries(projectRules).length > 0
            ? Object.entries(projectRules)
                .map(([pattern, act]) => `  ${pattern}: ${act}`)
                .join("\n")
            : "  (none)";

        const sessionLines =
          Object.entries(sessionRules).length > 0
            ? Object.entries(sessionRules)
                .map(([pattern, act]) => `  ${pattern}: ${act}`)
                .join("\n")
            : "  (none)";

        ctx.ui.notify(
          `pi-unbash: ${config.enabled ? "ENABLED" : "DISABLED"}\n\nDefault rules:\n${defaultLines}\n\nUser rules (global):\n${userLines}\n\nProject rules:\n${projectLines}\n\nSession rules:\n${sessionLines}`,
          "info",
        );
      } else if (action === "preset") {
        const { action: presetAction, name } = parsePresetSubcommand(target);

        if (presetAction === "add" && name) {
          config.presets.push(name);
          saveConfig(config);
          ctx.ui.notify(`Preset '${name}' added.`, "info");
        } else if (presetAction === "remove" && name) {
          config.presets = config.presets.filter((preset) => preset !== name);
          saveConfig(config);
          ctx.ui.notify(`Preset '${name}' removed.`, "info");
        } else if (presetAction === "clear") {
          config.presets = [];
          saveConfig(config);
          ctx.ui.notify("All active global presets cleared.", "info");
        } else if (presetAction === "list") {
          const projectResult = loadProjectConfig(ctx.cwd);
          const projectConfig = projectResult?.config ?? DEFAULT_CONFIG;

          if (projectResult?.warning) {
            ctx.ui.notify(`[pi-unbash] ${projectResult.warning}`, "warning");
          }

          ctx.ui.notify(
            buildPresetListMessage(config, projectConfig, sessionRules),
            "info",
          );
        } else {
          ctx.ui.notify(
            "Usage: /unbash preset <list|add|remove|clear> [name]",
            "warning",
          );
        }
      } else {
        ctx.ui.notify(
          "Usage: /unbash <allow|deny|toggle|list|preset> [command]",
          "warning",
        );
      }
    },
  });

  // The core interception hook
  pi.on("tool_call", async (event, ctx) => {
    if (configWarning && ctx.hasUI) {
      ctx.ui.notify(`[pi-unbash] ${configWarning}`, "warning");
      configWarning = undefined;
    }

    if (!config.enabled) return;

    const projectResult = loadProjectConfig(ctx.cwd);
    const projectConfig = projectResult?.config ?? DEFAULT_CONFIG;
    if (projectResult?.warning && ctx.hasUI) {
      ctx.ui.notify(`[pi-unbash] ${projectResult.warning}`, "warning");
    }

    const presetPolicies = resolvePresetPoliciesForConfigs(config, projectConfig);
    const newUnknownPresets = presetPolicies.unknownPresetNames.filter((name) =>
      !warnedUnknownPresets.has(name)
    );
    if (newUnknownPresets.length > 0 && ctx.hasUI) {
      ctx.ui.notify(
        `[pi-unbash] Unknown preset(s): ${newUnknownPresets.join(", ")}`,
        "warning",
      );
      for (const name of newUnknownPresets) warnedUnknownPresets.add(name);
    }

    const toolName = (event as { toolName?: unknown }).toolName;
    if (typeof toolName !== "string" || toolName.length === 0) return;

    const toolPolicy = presetPolicies.toolPolicies[toolName];
    if (toolPolicy === "deny") {
      return {
        block: true,
        reason: `Denied by tool policy for "${toolName}" (preset).`,
      };
    }
    if (toolPolicy === "allow") return;

    if (!isToolCallEventType("bash", event)) return;

    const rawCmd = event.input.command;
    if (!rawCmd || rawCmd.trim() === "") return;

    const layers = buildRuleLayers(config.rules, projectConfig.rules, sessionRules, {
      globalPresetRules: presetPolicies.globalPresetRules,
      projectPresetRules: presetPolicies.projectPresetRules,
    });

    const fastCommands = extractTopLevelFastCommands(rawCmd);
    if (fastCommands.length > 0) {
      const fastDecisions = fastCommands.map((cmd) =>
        resolveCommandDecisionFromTokens(cmd.name, cmd.args, layers)
      );

      const fastDenied = fastDecisions.find((decision) => decision.action === "deny");
      if (fastDenied) {
        return {
          block: true,
          reason: `Denied by fast rule "${fastDenied.pattern ?? "*"}": ${rawCmd.trim()}`,
        };
      }

      if (
        fastDecisions.every((decision) => decision.action === "allow") &&
        isFastAllowSafe(rawCmd)
      ) {
        return;
      }
    }

    let ast;
    try {
      ast = parseBash(rawCmd);
    } catch {
      if (!ctx.hasUI) {
        return {
          block: true,
          reason: "Failed to parse bash AST. Command rejected for safety.",
        };
      }

      pi.events.emit("nudge", { body: "Command needs approval" });
      const confirmed = await ctx.ui.confirm(
        "⚠️ Could Not Parse Command Safely",
        "\nAllow anyway?",
      );

      if (!confirmed) {
        return { block: true, reason: "User denied unparseable command." };
      }

      return;
    }

    if (Array.isArray(ast.errors) && ast.errors.length > 0) {
      if (!ctx.hasUI) {
        return {
          block: true,
          reason:
            "Bash AST contains parse errors. Command rejected for safety.",
        };
      }

      const firstError = ast.errors[0] ?? {
        message: "unknown parse error",
        pos: -1,
      };
      pi.events.emit("nudge", { body: "Command needs approval" });
      const confirmed = await ctx.ui.confirm(
        "⚠️ Command Parsed With Errors",
        `\nFirst error: ${firstError.message} at ${firstError.pos}\n\nAllow anyway?`,
      );

      if (!confirmed) {
        return {
          block: true,
          reason: "User denied command with parse errors.",
        };
      }

      return;
    }

    const allCommands = extractAllCommandsFromAST(ast, rawCmd);
    if (allCommands.length === 0) return;

    const decisions = allCommands.map((command) => ({
      command,
      decision: resolveCommandDecision(command, layers),
    }));

    const denied = decisions.find((entry) => entry.decision.action === "deny");
    if (denied) {
      return {
        block: true,
        reason: buildDeniedReason(denied.command, denied.decision, {
          maxLength: config.commandDisplayMaxLength,
          argMaxLength: config.commandDisplayArgMaxLength,
        }),
      };
    }

    const unauthorizedCommands = decisions
      .filter((entry) => entry.decision.action === "ask")
      .map((entry) => entry.command);

    if (unauthorizedCommands.length === 0) {
      return;
    }

    const deniedGuard = findDeniedGuard(
      detectTriggeredGuards(ast),
      presetPolicies.guards,
    );
    if (deniedGuard) {
      return {
        block: true,
        reason: `Denied by guard policy "${deniedGuard}" (preset).`,
      };
    }

    if (!ctx.hasUI) {
      return {
        block: true,
        reason: `Commands [${unauthorizedCommands.map((c) => formatCommand(c, { maxLength: config.commandDisplayMaxLength, argMaxLength: config.commandDisplayArgMaxLength })).join(", ")}] require UI confirmation.`,
      };
    }

    const uniqueBaseNames = Array.from(
      new Set(unauthorizedCommands.map(getCommandName)),
    );
    const alwaysLabel = `Always allow ${uniqueBaseNames.join(", ")} (this session)`;

    pi.events.emit("nudge", { body: "Command needs approval" });
    const choice = await ctx.ui.select(
      buildApprovalPrompt(allCommands, unauthorizedCommands, {
        maxLength: config.commandDisplayMaxLength,
        argMaxLength: config.commandDisplayArgMaxLength,
      }),
      ["Allow", alwaysLabel, "Reject"],
    );

    if (choice === alwaysLabel) {
      for (const name of uniqueBaseNames) {
        sessionRules[name] = "allow";
      }
      return;
    }

    if (choice !== "Allow") {
      return { block: true, reason: "User denied execution." };
    }
  });
}
