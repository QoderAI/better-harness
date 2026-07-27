import path from "node:path";

export const DEFAULT_SECRET_GUARD_PLATFORM = "qoder";

function quoteCommandArg(value) {
  return JSON.stringify(String(value));
}

function posixRelative(from, to) {
  return path.relative(from, to).split(path.sep).join("/");
}

function renderCodexBlock({ message, reasonCode }) {
  return {
    blocked: true,
    exitCode: 0,
    stdout: `${JSON.stringify({ decision: "block", reason: message, reasonCode })}\n`,
    stderr: "",
  };
}

function renderQoderBlock({ eventName, message, reasonCode }) {
  if (eventName === "PreToolUse") {
    return {
      blocked: true,
      exitCode: 0,
      stdout: `${JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: message,
          reasonCode,
        },
      })}\n`,
      stderr: "",
    };
  }

  return {
    blocked: true,
    exitCode: 2,
    stdout: `${message}\n`,
    stderr: "",
  };
}

function defaultSecretGuardCommand({ targetDir, scriptPath, mode, platform }) {
  const scriptRef = posixRelative(targetDir, scriptPath);
  return `node ${quoteCommandArg(scriptRef)} --mode=${mode} --platform=${platform.id}`;
}

function freezePlatform(definition) {
  return Object.freeze({
    ...definition,
    configPath: Object.freeze([...definition.configPath]),
    hookScriptPath: Object.freeze([...definition.hookScriptPath]),
    hookEvents: Object.freeze(
      Object.fromEntries(
        Object.entries(definition.hookEvents).map(([eventName, event]) => [
          eventName,
          Object.freeze({ ...event }),
        ]),
      ),
    ),
  });
}

export const secretGuardPlatforms = Object.freeze({
  qoder: freezePlatform({
    id: "qoder",
    displayName: "Qoder",
    configPath: [".qoder", "settings.json"],
    hookScriptPath: [".qoder", "hooks", "secret-scan.mjs"],
    settingsRootKey: "hooks",
    buildHookCommand: defaultSecretGuardCommand,
    renderBlock: renderQoderBlock,
    hookEvents: {
      UserPromptSubmit: {
        mode: "user-prompt",
      },
      PreToolUse: {
        matcher: "Bash|Read|Edit|Write|apply_patch",
        mode: "pre-tool",
      },
    },
  }),
  codex: freezePlatform({
    id: "codex",
    displayName: "Codex",
    configPath: [".codex", "hooks.json"],
    hookScriptPath: [".codex", "hooks", "secret-scan.mjs"],
    settingsRootKey: "hooks",
    buildHookCommand: defaultSecretGuardCommand,
    renderBlock: renderCodexBlock,
    hookEvents: {
      UserPromptSubmit: {
        mode: "user-prompt",
      },
      PreToolUse: {
        matcher: "Bash|Read|Edit|Write|apply_patch",
        mode: "pre-tool",
      },
    },
  }),
});

export function supportedSecretGuardPlatforms() {
  return Object.keys(secretGuardPlatforms).sort();
}

export function validateSecretGuardPlatformDefinition(platform) {
  const errors = [];
  if (!platform || typeof platform !== "object") {
    return ["platform definition must be an object"];
  }
  for (const field of ["id", "displayName", "settingsRootKey"]) {
    if (!platform[field] || typeof platform[field] !== "string") {
      errors.push(`${field} must be a non-empty string`);
    }
  }
  for (const field of ["configPath", "hookScriptPath"]) {
    if (!Array.isArray(platform[field]) || platform[field].length === 0 || platform[field].some((part) => !part || typeof part !== "string")) {
      errors.push(`${field} must be a non-empty string array`);
    }
  }
  if (!platform.hookEvents || typeof platform.hookEvents !== "object" || Object.keys(platform.hookEvents).length === 0) {
    errors.push("hookEvents must be a non-empty object");
  } else {
    for (const [eventName, event] of Object.entries(platform.hookEvents)) {
      if (!eventName) errors.push("hook event name must be non-empty");
      if (!event?.mode || typeof event.mode !== "string") {
        errors.push(`${eventName}.mode must be a non-empty string`);
      }
      if (Object.hasOwn(event, "matcher") && (!event.matcher || typeof event.matcher !== "string")) {
        errors.push(`${eventName}.matcher must be a non-empty string when present`);
      }
    }
  }
  if (typeof platform.buildHookCommand !== "function") {
    errors.push("buildHookCommand must be a function");
  }
  if (typeof platform.renderBlock !== "function") {
    errors.push("renderBlock must be a function");
  }
  return errors;
}

export function validateSecretGuardPlatforms(platforms = secretGuardPlatforms) {
  const errors = [];
  for (const [name, platform] of Object.entries(platforms)) {
    for (const error of validateSecretGuardPlatformDefinition(platform)) {
      errors.push(`${name}: ${error}`);
    }
  }
  return errors;
}

export function resolveSecretGuardPlatform(platform = DEFAULT_SECRET_GUARD_PLATFORM) {
  const name = String(platform ?? DEFAULT_SECRET_GUARD_PLATFORM).trim().toLowerCase();
  const definition = secretGuardPlatforms[name];
  if (!definition) {
    throw new Error(`platform must be one of: ${supportedSecretGuardPlatforms().join(", ")}`);
  }
  return definition;
}

export function resolveSecretGuardPlatformPaths(targetDir, platform) {
  const definition = typeof platform === "string" ? resolveSecretGuardPlatform(platform) : platform;
  return {
    settingsPath: path.join(targetDir, ...definition.configPath),
    scriptPath: path.join(targetDir, ...definition.hookScriptPath),
    settingsRootKey: definition.settingsRootKey,
  };
}

export function buildSecretGuardHookCommand({ targetDir, scriptPath, mode, platform }) {
  const definition = typeof platform === "string" ? resolveSecretGuardPlatform(platform) : platform;
  return definition.buildHookCommand({ targetDir, scriptPath, mode, platform: definition });
}

export function renderSecretGuardBlock({ platform, eventName, reasonCode, message }) {
  const definition = typeof platform === "string" ? resolveSecretGuardPlatform(platform) : platform;
  return definition.renderBlock({ eventName, reasonCode, message, platform: definition });
}
