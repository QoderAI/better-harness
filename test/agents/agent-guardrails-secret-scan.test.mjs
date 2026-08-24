import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { promises as fsPromises } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";

import {
  handleHookEvent,
  scanPaths,
  scanText,
} from "../../scripts/agent-guardrails/secret-scan.mjs";
import {
  installSecretGuard,
} from "../../scripts/agent-guardrails/install-secret-guard.mjs";
import {
  buildSecretGuardHookCommand,
  renderSecretGuardBlock,
  resolveSecretGuardPlatform,
  secretGuardPlatforms,
  supportedSecretGuardPlatforms,
  validateSecretGuardPlatforms,
} from "../../scripts/agent-guardrails/platforms.mjs";

const scannerCli = path.resolve("scripts/agent-guardrails/secret-scan.mjs");
const installerCli = path.resolve("scripts/agent-guardrails/install-secret-guard.mjs");

async function writeText(filePath, text) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, text);
}

async function writeJson(filePath, value) {
  await writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function syntheticOpenAiKey() {
  const body = [
    "T3st",
    "Only",
    "Synth",
    "Cred",
    "Value",
    "N0t",
    "Issued",
    "By",
    "Provider",
    "1234",
    "567890",
  ].join("");
  return [
    "sk",
    "proj",
    body,
  ].join("-");
}

function withFileIdentity(stats, identity) {
  return new Proxy(stats, {
    get(target, property) {
      if (Object.hasOwn(identity, property)) return identity[property];
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function identityForStats(identity, options) {
  if (options?.bigint === true) return identity;
  return Object.fromEntries(
    Object.entries(identity).map(([key, value]) => [key, Number(value)]),
  );
}

async function scanWithFileIdentities(beforeIdentity, openedIdentity) {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-secret-scan-identity-"));
  const workspace = path.join(root, "workspace");
  const configPath = path.join(workspace, "config.yaml");
  await mkdir(workspace, { recursive: true });
  await writeFile(configPath, "name: safe\n");

  const originalLstat = fsPromises.lstat;
  const originalOpen = fsPromises.open;
  fsPromises.lstat = async (target, ...args) => {
    const stats = await originalLstat.call(fsPromises, target, ...args);
    return path.resolve(String(target)) === configPath
      ? withFileIdentity(stats, identityForStats(beforeIdentity, args[0]))
      : stats;
  };
  fsPromises.open = async (target, ...args) => {
    const handle = await originalOpen.call(fsPromises, target, ...args);
    if (path.resolve(String(target)) !== configPath) return handle;
    return new Proxy(handle, {
      get(targetHandle, property) {
        if (property === "stat") {
          return async (...statArgs) => withFileIdentity(
            await targetHandle.stat(...statArgs),
            identityForStats(openedIdentity, statArgs[0]),
          );
        }
        const value = Reflect.get(targetHandle, property, targetHandle);
        return typeof value === "function" ? value.bind(targetHandle) : value;
      },
    });
  };

  try {
    return await scanPaths(["config.yaml"], {
      cwd: workspace,
      containmentRoot: workspace,
      failOn: "high",
      redact: true,
    });
  } finally {
    fsPromises.lstat = originalLstat;
    fsPromises.open = originalOpen;
    await rm(root, { recursive: true, force: true });
  }
}

test("secret guard platform registry owns host-specific install paths", () => {
  assert.deepEqual(supportedSecretGuardPlatforms(), ["codex", "qoder"]);
  assert.deepEqual(validateSecretGuardPlatforms(), []);
  assert.equal(secretGuardPlatforms.qoder.configPath.join("/"), ".qoder/settings.json");
  assert.equal(secretGuardPlatforms.qoder.hookScriptPath.join("/"), ".qoder/hooks/secret-scan.mjs");
  assert.equal(secretGuardPlatforms.codex.configPath.join("/"), ".codex/hooks.json");
  assert.equal(secretGuardPlatforms.codex.hookScriptPath.join("/"), ".codex/hooks/secret-scan.mjs");
  assert.equal(resolveSecretGuardPlatform("QODER").id, "qoder");
  assert.throws(() => resolveSecretGuardPlatform("cursor"), /platform must be one of: codex, qoder/);
});

test("secret guard platform registry owns runtime output and command building", () => {
  const codexBlock = renderSecretGuardBlock({
    platform: "codex",
    eventName: "PreToolUse",
    reasonCode: "test-reason",
    message: "blocked",
  });
  assert.equal(codexBlock.exitCode, 0);
  assert.deepEqual(JSON.parse(codexBlock.stdout), {
    decision: "block",
    reason: "blocked",
    reasonCode: "test-reason",
  });

  const qoderBlock = renderSecretGuardBlock({
    platform: "qoder",
    eventName: "PreToolUse",
    reasonCode: "test-reason",
    message: "blocked",
  });
  const qoderPayload = JSON.parse(qoderBlock.stdout);
  assert.equal(qoderBlock.exitCode, 0);
  assert.equal(qoderPayload.hookSpecificOutput.permissionDecision, "deny");
  assert.equal(qoderPayload.hookSpecificOutput.reasonCode, "test-reason");

  const targetDir = path.join(os.tmpdir(), "project with spaces");
  const scriptPath = path.join(targetDir, ".qoder", "secret hooks", "secret-scan.mjs");
  assert.equal(
    buildSecretGuardHookCommand({ targetDir, scriptPath, mode: "pre-tool", platform: "qoder" }),
    'node ".qoder/secret hooks/secret-scan.mjs" --mode=pre-tool --platform=qoder',
  );
});

test("scanText detects synthetic keys and redacts public findings", () => {
  const fakeKey = syntheticOpenAiKey();
  const findings = scanText(`OPENAI_API_KEY=${fakeKey}`, {
    file: "prompt.txt",
    redact: true,
  });

  assert.equal(findings.length, 1);
  assert.equal(findings[0].ruleId, "openai-api-key");
  assert.match(findings[0].secret, /\*{6,}/);
  assert.doesNotMatch(JSON.stringify(findings), new RegExp(fakeKey));
  assert.doesNotMatch(findings[0].context, new RegExp(fakeKey));
});

test("URL credential scanning ignores template-only basic auth and detects literal DingTalk webhook defaults", () => {
  const templateFindings = scanText("PROXY=https://build-user:${{env.PROXY_PASSWORD}}@proxy.example.test/path", {
    file: "config.yaml",
    redact: true,
  });
  assert.equal(templateFindings.some((finding) => finding.ruleId === "url-basic-auth"), false);

  const webhookToken = Array.from({ length: 64 }, (_, index) => "A3b7C9d2E5f8G1h4"[index % 16]).join("");
  const webhookFindings = scanText(
    `default: https://oapi.dingtalk.com/robot/send?access_token=${webhookToken}`,
    { file: "build-action.yaml", redact: true },
  );
  const finding = webhookFindings.find((row) => row.ruleId === "dingtalk-webhook-token");

  assert.ok(finding);
  assert.equal(finding.severity, "critical");
  assert.doesNotMatch(JSON.stringify(webhookFindings), new RegExp(webhookToken));

  const defaultUrl = `https://notify.invalid/webhook/send/${webhookToken}`;
  const defaultFindings = scanText([
    "dingtalk-webhook:",
    "  name: DingTalk webhook",
    "  type: string",
    `  default: \"${defaultUrl}\"`,
  ].join("\n"), { file: "build-action.yaml", redact: true });
  const defaultFinding = defaultFindings.find((row) => row.ruleId === "dingtalk-webhook-default");

  assert.ok(defaultFinding);
  assert.equal(defaultFinding.severity, "critical");
  assert.doesNotMatch(JSON.stringify(defaultFindings), new RegExp(webhookToken));
  assert.doesNotMatch(JSON.stringify(defaultFindings), new RegExp(defaultUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("workspace-contained scanning refuses a swap to an external symlink at read time", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-secret-scan-containment-"));
  const workspace = path.join(root, "workspace");
  const configPath = path.join(workspace, "config.yaml");
  const outsidePath = path.join(root, "outside.yaml");
  const probePath = path.join(workspace, "symlink-probe");
  const outsideKey = syntheticOpenAiKey();
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  await mkdir(workspace, { recursive: true });
  await writeFile(configPath, "name: safe\n");
  await writeFile(outsidePath, `OPENAI_API_KEY=${outsideKey}\n`);
  try {
    await symlink(outsidePath, probePath);
    await rm(probePath);
  } catch (error) {
    t.skip(`symlink unavailable: ${error.message}`);
    return;
  }

  const originalOpen = fsPromises.open;
  let swapped = false;
  fsPromises.open = async (target, ...args) => {
    if (!swapped && path.resolve(String(target)) === configPath) {
      swapped = true;
      await rm(configPath);
      await symlink(outsidePath, configPath);
    }
    return originalOpen.call(fsPromises, target, ...args);
  };
  let report;
  try {
    report = await scanPaths(["config.yaml"], {
      cwd: workspace,
      containmentRoot: workspace,
      failOn: "high",
      redact: true,
    });
  } finally {
    fsPromises.open = originalOpen;
  }

  assert.equal(swapped, true);
  assert.equal(report.summary.totalFindings, 0);
  assert.equal(report.stats.scannedFiles, 0);
  assert.equal(report.coverageStatus, "failed");
  assert.ok(report.stats.errors.length > 0);
  assert.doesNotMatch(JSON.stringify(report.findings), new RegExp(outsideKey));
});

test("workspace-contained scanning rejects distinct full-width identities that collide as Numbers", async () => {
  const firstInode = BigInt(Number.MAX_SAFE_INTEGER) + 1n;
  const secondInode = firstInode + 1n;
  assert.notEqual(firstInode, secondInode);
  assert.equal(Number(firstInode), Number(secondInode));

  const report = await scanWithFileIdentities(
    { dev: 7n, ino: firstInode },
    { dev: 7n, ino: secondInode },
  );

  assert.equal(report.stats.scannedFiles, 0);
  assert.equal(report.coverageStatus, "failed");
  assert.ok(report.stats.errors.length > 0);
});

test("workspace-contained scanning accepts an identical full-width identity", async () => {
  const inode = BigInt(Number.MAX_SAFE_INTEGER) + 1n;
  const report = await scanWithFileIdentities(
    { dev: 7n, ino: inode },
    { dev: 7n, ino: inode },
  );

  assert.equal(report.stats.scannedFiles, 1);
  assert.equal(report.coverageStatus, "complete");
  assert.equal(report.stats.errors.length, 0);
});

test("workspace-contained scanning rejects ordinary device and inode mismatches", async () => {
  const deviceMismatch = await scanWithFileIdentities(
    { dev: 7n, ino: 101n },
    { dev: 8n, ino: 101n },
  );
  const inodeMismatch = await scanWithFileIdentities(
    { dev: 7n, ino: 101n },
    { dev: 7n, ino: 102n },
  );

  for (const report of [deviceMismatch, inodeMismatch]) {
    assert.equal(report.stats.scannedFiles, 0);
    assert.equal(report.coverageStatus, "failed");
    assert.ok(report.stats.errors.length > 0);
  }
});

test("workspace-contained scanning preserves sub-millisecond fallback precision when inode is unavailable", async () => {
  const before = {
    dev: 0n,
    ino: 0n,
    size: 11n,
    mtimeMs: 1_000n,
    birthtimeMs: 500n,
    mtimeNs: 1_000_000_001n,
    birthtimeNs: 500_000_000n,
  };
  const opened = {
    ...before,
    mtimeNs: before.mtimeNs + 1n,
  };

  const report = await scanWithFileIdentities(before, opened);

  assert.equal(report.stats.scannedFiles, 0);
  assert.equal(report.coverageStatus, "failed");
  assert.ok(report.stats.errors.length > 0);
});

test("workspace-contained scanning accepts identical metadata when inode is unavailable", async () => {
  const identity = {
    dev: 0n,
    ino: 0n,
    size: 11n,
    mtimeMs: 1_000n,
    birthtimeMs: 500n,
    mtimeNs: 1_000_000_001n,
    birthtimeNs: 500_000_000n,
  };

  const report = await scanWithFileIdentities(identity, identity);

  assert.equal(report.stats.scannedFiles, 1);
  assert.equal(report.coverageStatus, "complete");
  assert.equal(report.stats.errors.length, 0);
});

test("UserPromptSubmit hook blocks secrets without echoing the value", async () => {
  const fakeKey = syntheticOpenAiKey();
  const result = await handleHookEvent({
    mode: "user-prompt",
    platform: "codex",
    event: {
      hook_event_name: "UserPromptSubmit",
      prompt: `Use ${fakeKey} for this request.`,
    },
  });

  assert.equal(result.blocked, true);
  assert.equal(result.exitCode, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.decision, "block");
  assert.match(payload.reason, /secret|credential|凭据/i);
  assert.doesNotMatch(result.stdout, new RegExp(fakeKey));
});

test("hook event handling keeps host as a compatibility alias only", async () => {
  const result = await handleHookEvent({
    mode: "pre-tool",
    host: "qoder",
    event: {
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      tool_input: {
        file_path: ".env",
      },
    },
  });

  assert.equal(result.blocked, true);
  assert.match(result.stdout, /permissionDecision/);
  await assert.rejects(
    () => handleHookEvent({
      mode: "user-prompt",
      host: "qoder",
      platform: "codex",
      event: { prompt: syntheticOpenAiKey() },
    }),
    /host \(qoder\) and platform \(codex\) must match/,
  );
});

test("secret-scan CLI hook mode reads JSON stdin and emits a block payload", () => {
  const fakeKey = syntheticOpenAiKey();
  const result = spawnSync(process.execPath, [scannerCli, "--mode=user-prompt", "--platform=codex"], {
    input: JSON.stringify({ prompt: `Please use ${fakeKey}` }),
    encoding: "utf8",
  });

  assert.equal(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.decision, "block");
  assert.doesNotMatch(result.stdout, new RegExp(fakeKey));
  assert.equal(result.stderr, "");
});

test("secret-scan CLI fails closed when an explicit path cannot be scanned", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-secret-scan-missing-"));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, [scannerCli, "missing.txt", "--json"], {
    cwd: root,
    encoding: "utf8",
  });

  assert.equal(result.status, 3);
  const report = JSON.parse(result.stdout);
  assert.equal(report.coverageStatus, "failed");
  assert.ok(report.stats.errors.length > 0);
  assert.equal(result.stderr, "");
});

test("secret-scan CLI reports complete coverage and exits zero for a clean explicit file", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-secret-scan-clean-"));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "clean.txt"), "ordinary fixture text\n");
  const result = spawnSync(process.execPath, [scannerCli, "clean.txt", "--json"], {
    cwd: root,
    encoding: "utf8",
  });

  assert.equal(result.status, 0);
  const report = JSON.parse(result.stdout);
  assert.equal(report.coverageStatus, "complete");
  assert.equal(report.summary.totalFindings, 0);
  assert.deepEqual(report.stats.errors, []);
  assert.equal(result.stderr, "");
});

test("secret-scan CLI treats an explicitly supplied symbolic-link file as incomplete coverage", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-secret-scan-link-"));
  const target = path.join(root, "target.txt");
  const link = path.join(root, "linked.txt");
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  await writeFile(target, "safe fixture\n");
  try {
    await symlink(target, link);
  } catch (error) {
    t.skip(`symlink unavailable: ${error.message}`);
    return;
  }

  const result = spawnSync(process.execPath, [scannerCli, link, "--json"], {
    cwd: root,
    encoding: "utf8",
  });

  assert.equal(result.status, 3);
  const report = JSON.parse(result.stdout);
  assert.equal(report.coverageStatus, "failed");
  assert.ok(report.stats.errors.length > 0);
});

test("secret-scan CLI treats symbolic links nested in a scanned directory as incomplete coverage", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-secret-scan-nested-link-"));
  const scanRoot = path.join(root, "scan");
  const target = path.join(root, "target.txt");
  const link = path.join(scanRoot, "linked.txt");
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  await mkdir(scanRoot, { recursive: true });
  await writeFile(target, "safe fixture\n");
  try {
    await symlink(target, link);
  } catch (error) {
    t.skip(`symlink unavailable: ${error.message}`);
    return;
  }

  const result = spawnSync(process.execPath, [scannerCli, scanRoot, "--json"], {
    encoding: "utf8",
  });

  assert.equal(result.status, 3);
  const report = JSON.parse(result.stdout);
  assert.equal(report.coverageStatus, "failed");
  assert.equal(report.stats.scannedFiles, 0);
  assert.equal(report.stats.skippedFiles, 1);
  assert.match(report.stats.errors.join("\n"), /symbolic-link scan targets are not inspected/u);

  await writeFile(path.join(scanRoot, "clean.txt"), "ordinary fixture text\n");
  const partialResult = spawnSync(process.execPath, [scannerCli, scanRoot, "--json"], {
    encoding: "utf8",
  });
  assert.equal(partialResult.status, 3);
  const partialReport = JSON.parse(partialResult.stdout);
  assert.equal(partialReport.coverageStatus, "partial");
  assert.equal(partialReport.stats.scannedFiles, 1);
  assert.equal(partialReport.stats.skippedFiles, 1);
});

test("install-secret-guard CLI keeps --host as a compatibility alias", () => {
  const result = spawnSync(process.execPath, [installerCli, "--host=codex", "--dry-run", "--json"], {
    encoding: "utf8",
  });

  assert.equal(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.platform, "codex");
  assert.equal(payload.host, "codex");
  assert.match(payload.commands.UserPromptSubmit, /--platform=codex/);
  assert.equal(result.stderr, "");
});

test("PreToolUse hook blocks credential file reads and avoids full command echo", async () => {
  const result = await handleHookEvent({
    mode: "pre-tool",
    host: "qoder",
    event: {
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: {
        command: "cat .env && printenv OPENAI_API_KEY",
      },
    },
  });

  assert.equal(result.blocked, true);
  assert.equal(result.exitCode, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.hookSpecificOutput.permissionDecision, "deny");
  assert.match(payload.hookSpecificOutput.permissionDecisionReason, /credential|secret|凭据/i);
  assert.doesNotMatch(result.stdout, /cat \.env/);
  assert.doesNotMatch(result.stdout, /OPENAI_API_KEY/);
});

test("PreToolUse hook scans write tool content without echoing secrets", async () => {
  const cases = [
    {
      name: "Write.content",
      tool_name: "Write",
      tool_input: {
        file_path: "notes.txt",
        content: `OPENAI_API_KEY=${syntheticOpenAiKey()}`,
      },
    },
    {
      name: "Edit.new_string",
      tool_name: "Edit",
      tool_input: {
        file_path: "notes.txt",
        old_string: "OPENAI_API_KEY=<redacted>",
        new_string: `OPENAI_API_KEY=${syntheticOpenAiKey()}`,
      },
    },
    {
      name: "apply_patch patch",
      tool_name: "apply_patch",
      tool_input: {
        patch: [
          "*** Begin Patch",
          "*** Add File: notes.txt",
          `+OPENAI_API_KEY=${syntheticOpenAiKey()}`,
          "*** End Patch",
        ].join("\n"),
      },
    },
  ];

  for (const row of cases) {
    const secret = row.tool_input.content
      ?? row.tool_input.new_string
      ?? row.tool_input.patch.match(/sk-proj-[A-Za-z0-9_-]+/u)[0];
    const result = await handleHookEvent({
      mode: "pre-tool",
      platform: "codex",
      event: row,
    });

    assert.equal(result.blocked, true, row.name);
    assert.equal(result.exitCode, 0, row.name);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.decision, "block", row.name);
    assert.match(payload.reason, /credential|secret|凭据/i, row.name);
    assert.doesNotMatch(result.stdout, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), row.name);
  }
});

test("PreToolUse hook scans freeform apply_patch payloads", async () => {
  const secret = syntheticOpenAiKey();
  const patch = [
    "*** Begin Patch",
    "*** Add File: notes.txt",
    `+OPENAI_API_KEY=${secret}`,
    "*** End Patch",
  ].join("\n");
  const events = [
    {
      tool_name: "apply_patch",
      tool_input: patch,
    },
    {
      toolName: "apply_patch",
      toolInput: patch,
    },
  ];

  for (const event of events) {
    const result = await handleHookEvent({
      mode: "pre-tool",
      platform: "codex",
      event,
    });

    assert.equal(result.blocked, true);
    assert.equal(JSON.parse(result.stdout).reasonCode, "secret-in-tool-content");
    assert.doesNotMatch(result.stdout, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("PreToolUse hook normalizes camelCase Bash and Read payloads", async () => {
  const bashResult = await handleHookEvent({
    mode: "pre-tool",
    platform: "codex",
    event: {
      hookEventName: "PreToolUse",
      toolName: "Bash",
      toolInput: {
        command: "cat .env && printenv OPENAI_API_KEY",
      },
    },
  });

  assert.equal(bashResult.blocked, true);
  assert.equal(JSON.parse(bashResult.stdout).reasonCode, "read-env-file");
  assert.doesNotMatch(bashResult.stdout, /cat \.env/);
  assert.doesNotMatch(bashResult.stdout, /OPENAI_API_KEY/);

  const readResult = await handleHookEvent({
    mode: "pre-tool",
    platform: "codex",
    event: {
      hookEventName: "PreToolUse",
      toolName: "Read",
      toolInput: {
        filePath: ".env.local",
      },
    },
  });

  assert.equal(readResult.blocked, true);
  assert.equal(JSON.parse(readResult.stdout).reasonCode, "protected-credential-path");
  assert.doesNotMatch(readResult.stdout, /\.env\.local/);
});

test("PreToolUse hook normalizes args and nested data payloads", async () => {
  const argsResult = await handleHookEvent({
    mode: "pre-tool",
    platform: "codex",
    event: {
      name: "Write",
      args: {
        filePath: "notes.txt",
        content: `OPENAI_API_KEY=${syntheticOpenAiKey()}`,
      },
    },
  });

  assert.equal(argsResult.blocked, true);
  assert.equal(JSON.parse(argsResult.stdout).reasonCode, "secret-in-tool-content");
  assert.doesNotMatch(argsResult.stdout, /OPENAI_API_KEY/);

  const nestedResult = await handleHookEvent({
    mode: "pre-tool",
    platform: "codex",
    event: {
      name: "PreToolUse",
      input: {
        eventId: "outer-envelope",
      },
      data: {
        toolName: "Read",
        toolInput: {
          filePath: ".env.local",
        },
      },
    },
  });

  assert.equal(nestedResult.blocked, true);
  assert.equal(JSON.parse(nestedResult.stdout).reasonCode, "protected-credential-path");
  assert.doesNotMatch(nestedResult.stdout, /\.env\.local/);
});

test("installSecretGuard merges Qoder settings and is idempotent", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-secret-guard-qoder-"));
  const target = path.join(root, "project");
  try {
    await writeJson(path.join(target, ".qoder", "settings.json"), {
      hooks: {
        Stop: [
          {
            hooks: [{ type: "command", command: "node existing-stop.mjs" }],
          },
        ],
      },
    });

    const first = await installSecretGuard({ targetDir: target, host: "qoder" });
    const second = await installSecretGuard({ targetDir: target, host: "qoder" });

    assert.equal(first.host, "qoder");
    assert.equal(second.addedHooks.length, 0);
    assert.ok(first.copiedScript.endsWith(path.join(".qoder", "hooks", "secret-scan.mjs")));
    assert.ok(first.copiedFiles.platforms.endsWith(path.join(".qoder", "hooks", "platforms.mjs")));

    const settings = await readJson(path.join(target, ".qoder", "settings.json"));
    assert.equal(settings.hooks.Stop.length, 1);
    assert.equal(settings.hooks.UserPromptSubmit.length, 1);
    assert.equal(settings.hooks.PreToolUse.length, 1);
    assert.match(settings.hooks.UserPromptSubmit[0].hooks[0].command, /\.qoder[\\/]hooks[\\/]secret-scan\.mjs/);
    assert.match(settings.hooks.PreToolUse[0].hooks[0].command, /--mode=pre-tool/);
    assert.match(settings.hooks.PreToolUse[0].hooks[0].command, /--platform=qoder/);

    const copied = await readFile(path.join(target, ".qoder", "hooks", "secret-scan.mjs"), "utf8");
    assert.match(copied, /handleHookEvent/);
    const copiedPlatforms = await readFile(path.join(target, ".qoder", "hooks", "platforms.mjs"), "utf8");
    assert.match(copiedPlatforms, /renderSecretGuardBlock/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("installSecretGuard check reports missing, current, and drifted targets", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-secret-guard-check-"));
  const target = path.join(root, "project");
  try {
    const missing = await installSecretGuard({ targetDir: target, platform: "qoder", check: true });
    assert.equal(missing.needsInstall, true);
    assert.equal(missing.check.script.targetExists, false);
    assert.equal(missing.check.config.matches, false);
    assert.equal(missing.check.config.hooks.UserPromptSubmit.present, false);

    const installed = await installSecretGuard({ targetDir: target, platform: "qoder" });
    assert.equal(installed.needsInstall, false);
    assert.equal(installed.check.script.matches, true);
    assert.equal(installed.check.runtimeFiles.platforms.matches, true);
    assert.equal(installed.check.config.matches, true);
    assert.equal(installed.check.script.sourceHash, installed.check.script.targetHash);

    const cleanCheck = spawnSync(process.execPath, [installerCli, "--target", target, "--platform=qoder", "--check", "--json"], {
      encoding: "utf8",
    });
    assert.equal(cleanCheck.status, 0);
    assert.equal(JSON.parse(cleanCheck.stdout).needsInstall, false);

    await writeText(path.join(target, ".qoder", "hooks", "secret-scan.mjs"), "tampered\n");
    const driftCheck = spawnSync(process.execPath, [installerCli, "--target", target, "--platform=qoder", "--check", "--json"], {
      encoding: "utf8",
    });
    assert.equal(driftCheck.status, 1);
    const drift = JSON.parse(driftCheck.stdout);
    assert.equal(drift.needsInstall, true);
    assert.equal(drift.check.script.matches, false);
    assert.equal(drift.check.config.matches, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("installSecretGuard merges Codex hooks without replacing existing hooks", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-secret-guard-codex-"));
  const target = path.join(root, "project");
  try {
    await writeJson(path.join(target, ".codex", "hooks.json"), {
      hooks: {
        Stop: [
          {
            hooks: [{ type: "command", command: "node check-stop.mjs" }],
          },
        ],
      },
    });

    const result = await installSecretGuard({ targetDir: target, platform: "codex" });

    assert.equal(result.platform, "codex");
    assert.equal(result.host, "codex");
    assert.ok(result.addedHooks.includes("UserPromptSubmit"));
    assert.ok(result.addedHooks.includes("PreToolUse"));

    const settings = await readJson(path.join(target, ".codex", "hooks.json"));
    assert.equal(settings.hooks.Stop.length, 1);
    assert.equal(settings.hooks.UserPromptSubmit.length, 1);
    assert.equal(settings.hooks.PreToolUse.length, 1);
    assert.match(settings.hooks.UserPromptSubmit[0].hooks[0].command, /\.codex[\\/]hooks[\\/]secret-scan\.mjs/);
    assert.match(settings.hooks.UserPromptSubmit[0].hooks[0].command, /--platform=codex/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
