export type PersistentRuleAction = "allow" | "ask" | "deny";
export type PolicyAction = "allow" | "deny";

export interface UnbashPreset {
  rules?: Record<string, PersistentRuleAction>;
  toolPolicies?: Record<string, PolicyAction>;
  guards?: Record<string, PolicyAction>;
}

export interface PresetConfigLike {
  presets?: string[];
  customPresets?: Record<string, UnbashPreset>;
}

export interface PresetContext {
  activePresets: string[];
  customPresets: Record<string, UnbashPreset>;
}

export interface EffectivePresetPolicies {
  rules: Record<string, PersistentRuleAction>;
  toolPolicies: Record<string, PolicyAction>;
  guards: Record<string, PolicyAction>;
  unknownPresetNames: string[];
}

export const BUILTIN_PRESETS: Record<string, UnbashPreset> = {
  "destructive-calls": {
    rules: {
      "rm -rf /": "deny",
      "rm -rf /*": "deny",
      "rm -rf .": "deny",
      "rm -rf ~": "deny",
      "rm -rf ~/*": "deny",
      "rm -rf $HOME": "deny",
      "rm -r /": "deny",
      "rm -r /*": "deny",
      "rm -r ~": "deny",
      "rm -r ~/*": "deny",
      mkfs: "deny",
      "mkfs.ext4": "deny",
      "mkfs.ext3": "deny",
      "mkfs.vfat": "deny",
      "mkfs.ntfs": "deny",
      "dd if=/dev/zero of=/dev": "deny",
      "dd of=/dev": "deny",
      shutdown: "deny",
      reboot: "deny",
      halt: "deny",
      poweroff: "deny",
      "init 0": "deny",
      "init 6": "deny",
      ":(){ :|: & };:": "deny",
      ":() { :|:& };:": "deny",
      "chmod -R 777 /": "deny",
      "chmod -R 000 /": "deny",
      "chown -R": "deny",
      "powershell Remove-Item -Recurse -Force": "deny",
      "Format-Volume": "deny",
      "format.com": "deny",
    },
  },
  "pi-bash-restrict": {
    toolPolicies: {
      grep: "deny",
      find: "deny",
      ls: "deny",
    },
    rules: {
      sudo: "deny",
      bash: "deny",
      sh: "deny",
      zsh: "deny",
      cat: "deny",
      tee: "deny",
      xargs: "deny",
      nl: "deny",
      fd: "deny",
      find: "deny",
      grep: "deny",
      ls: "deny",
      tree: "deny",
      eval: "deny",
      exec: "deny",
      nohup: "deny",
      timeout: "deny",
      time: "deny",
      watch: "deny",
      stdbuf: "deny",
      npx: "deny",
      uvx: "deny",
      bunx: "deny",
      pnpx: "deny",
      "pnpm dlx": "deny",
      "yarn dlx": "deny",
      "npm exec": "deny",
      "bun x": "deny",
      "uv tool run": "deny",
      "npm create": "deny",
      "npm init": "deny",
      "yarn create": "deny",
      "pnpm create": "deny",
      "bun create": "deny",
      "git add": "deny",
      "git commit": "deny",
      "git push": "deny",
      "git merge": "deny",
      "git rebase": "deny",
      "git reset": "deny",
      "git checkout": "deny",
      "git switch": "deny",
      "git cherry-pick": "deny",
      "git grep": "deny",
      "sed -i": "deny",
      "sed --in-place": "deny",
    },
    guards: {
      "command-substitution": "deny",
      "process-substitution": "deny",
      "variable-expansion": "deny",
      redirects: "deny",
      subshells: "deny",
      "background-execution": "deny",
      "control-flow": "deny",
      "function-definition": "deny",
    },
  },
};

export function buildPresetContext(
  globalConfig: PresetConfigLike,
  projectConfig: PresetConfigLike,
): PresetContext {
  return {
    activePresets: [
      ...(globalConfig.presets ?? []),
      ...(projectConfig.presets ?? []),
    ],
    customPresets: {
      ...(globalConfig.customPresets ?? {}),
      ...(projectConfig.customPresets ?? {}),
    },
  };
}

export function buildEffectivePresetPolicies(
  context: PresetContext,
): EffectivePresetPolicies {
  const availablePresets = {
    ...BUILTIN_PRESETS,
    ...context.customPresets,
  };

  const effective: EffectivePresetPolicies = {
    rules: {},
    toolPolicies: {},
    guards: {},
    unknownPresetNames: [],
  };

  for (const name of context.activePresets) {
    const preset = availablePresets[name];
    if (!preset) {
      effective.unknownPresetNames.push(name);
      continue;
    }

    if (preset.rules) {
      effective.rules = { ...effective.rules, ...preset.rules };
    }
    if (preset.toolPolicies) {
      effective.toolPolicies = {
        ...effective.toolPolicies,
        ...preset.toolPolicies,
      };
    }
    if (preset.guards) {
      effective.guards = { ...effective.guards, ...preset.guards };
    }
  }

  return effective;
}
