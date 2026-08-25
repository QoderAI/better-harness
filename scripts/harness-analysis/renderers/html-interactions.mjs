export function installHtmlReportInteractions({
  document,
  navigator,
  location,
  labels,
  schedule = (callback, delay) => globalThis.setTimeout(callback, delay),
}) {
  document.documentElement.classList.remove("no-js");

  function readJson(id) {
    const element = document.getElementById(id);
    if (!element) return { ok: false, value: null };
    try {
      return { ok: true, value: JSON.parse(element.textContent || "{}") };
    } catch {
      return { ok: false, value: null };
    }
  }

  function hasOnlyKeys(value, keys) {
    return value && typeof value === "object" && !Array.isArray(value)
      && Object.keys(value).every((key) => keys.includes(key));
  }

  function safeReportRoute(value) {
    if (typeof value !== "string" || value.length === 0 || value.includes("\\")) return false;
    if (value.startsWith("/") || /^[A-Za-z]:/u.test(value)) return false;
    const segments = value.split("/");
    return segments.at(-1) === "report.html"
      && segments.every((segment) => segment && segment !== "." && segment !== "..");
  }

  const reportDataState = readJson("harness-report-data");
  const reportActionsState = readJson("harness-report-actions");
  const prompts = new Map();
  const actions = new Map();
  let bindingMode = "invalid";
  let reportRoute = null;

  if (reportDataState.ok
    && hasOnlyKeys(reportDataState.value, ["findings"])
    && Array.isArray(reportDataState.value.findings)) {
    let validPrompts = true;
    for (const finding of reportDataState.value.findings) {
      const id = String(finding?.id ?? "");
      if (!hasOnlyKeys(finding, ["id", "aiFixPrompt"])
        || !id
        || typeof finding.aiFixPrompt !== "string"
        || finding.aiFixPrompt.trim().length === 0
        || prompts.has(id)) {
        validPrompts = false;
        break;
      }
      prompts.set(id, finding.aiFixPrompt);
    }

    const payload = reportActionsState.value;
    if (validPrompts
      && reportActionsState.ok
      && hasOnlyKeys(payload, ["reportRoute", "findings"])
      && Array.isArray(payload.findings)) {
      let validActions = true;
      for (const finding of payload.findings) {
        const id = String(finding?.id ?? "");
        if (!hasOnlyKeys(finding, ["id", "expectedRevision"])
          || !id
          || !Number.isInteger(finding.expectedRevision)
          || finding.expectedRevision < 0
          || actions.has(id)) {
          validActions = false;
          break;
        }
        actions.set(id, finding);
      }
      const sameIds = actions.size === prompts.size
        && [...prompts.keys()].every((id) => actions.has(id));
      if (validActions && payload.reportRoute === null && actions.size === 0) {
        bindingMode = "empty";
      } else if (validActions && safeReportRoute(payload.reportRoute) && sameIds) {
        bindingMode = "bound";
        reportRoute = payload.reportRoute;
      }
    }
  }

  function resolveBindingPaths() {
    try {
      const url = new URL(String(location?.href ?? ""));
      if (url.protocol !== "file:") return null;
      const pathname = decodeURIComponent(url.pathname);
      const windowsDrive = /^\/[A-Za-z]:\//u.test(pathname);
      const windowsUnc = Boolean(url.hostname);
      const suffix = `/${reportRoute}`;
      const comparablePath = windowsDrive || windowsUnc ? pathname.toLowerCase() : pathname;
      const comparableSuffix = windowsDrive || windowsUnc ? suffix.toLowerCase() : suffix;
      if (!comparablePath.endsWith(comparableSuffix)) return null;

      const workspaceUrlPath = pathname.slice(0, pathname.length - suffix.length);
      const reportDirectory = pathname.slice(0, pathname.lastIndexOf("/"));
      const findingsUrlPath = `${reportDirectory}/findings.json`;
      const toNativePath = (value) => {
        if (windowsDrive) return value.slice(1).replace(/\//gu, "\\");
        if (windowsUnc) {
          const host = decodeURIComponent(url.hostname);
          return `\\\\${host}${value.replace(/\//gu, "\\")}`;
        }
        return value || "/";
      };
      return {
        workspacePath: toNativePath(workspaceUrlPath),
        findingsPath: toNativePath(findingsUrlPath),
      };
    } catch {
      return null;
    }
  }

  function promptForFinding(findingId) {
    if (bindingMode === "invalid") return null;
    const id = String(findingId);
    const prompt = prompts.get(id);
    if (typeof prompt !== "string" || prompt.trim().length === 0) return null;
    if (bindingMode === "empty") return prompt;
    const paths = resolveBindingPaths();
    if (!paths) return prompt;
    const action = actions.get(id);
    if (!action) return null;
    const callback = {
      contract: "better-harness-fix-output/v1",
      workspacePath: paths.workspacePath,
      findingsPath: paths.findingsPath,
      findingId: id,
      expectedRevision: action.expectedRevision,
    };
    return `${prompt}\n\n<better-harness-fix-output>\n${JSON.stringify(callback)}\n</better-harness-fix-output>`;
  }

  const status = document.getElementById("copy-status");
  const manualDialog = document.getElementById("manual-copy-dialog");
  const manualText = document.getElementById("manual-copy-text");
  const dialogTriggers = new Map();

  function report(message, state) {
    if (!status) return;
    status.textContent = message;
    status.dataset.state = state;
  }

  function legacyCopy(prompt) {
    const textarea = document.createElement("textarea");
    textarea.value = prompt;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    try {
      textarea.select();
      return document.execCommand("copy") === true;
    } catch {
      return false;
    } finally {
      textarea.remove();
    }
  }

  function copied(trigger) {
    report(labels.copySuccess, "success");
    if (trigger) {
      const originalLabel = trigger.textContent;
      trigger.textContent = labels.copied;
      schedule(() => {
        trigger.textContent = originalLabel || labels.copy;
      }, 1800);
    }
    return true;
  }

  async function copyFinding(findingId, trigger) {
    const prompt = promptForFinding(findingId);
    if (typeof prompt !== "string" || prompt.length === 0) {
      report(labels.missingPrompt, "error");
      return false;
    }

    try {
      if (!navigator?.clipboard?.writeText) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(prompt);
      return copied(trigger);
    } catch {
      if (legacyCopy(prompt)) return copied(trigger);
    }

    if (manualDialog && typeof manualDialog.showModal === "function") {
      dialogTriggers.set(manualDialog.id, trigger);
      if (!manualDialog.open) manualDialog.showModal();
    }
    if (manualText) {
      manualText.value = prompt;
      manualText.focus();
      manualText.select();
    }
    report(labels.manualCopy, "error");
    return false;
  }

  function openDialog(dialogId, trigger) {
    const dialog = document.getElementById(dialogId);
    if (!dialog || typeof dialog.showModal !== "function") return false;
    dialogTriggers.set(dialogId, trigger);
    dialog.showModal();
    return true;
  }

  function closeDialog(dialogId) {
    const dialog = document.getElementById(dialogId);
    if (!dialog || !dialog.open || typeof dialog.close !== "function") return false;
    dialog.close();
    return true;
  }

  for (const trigger of document.querySelectorAll("[data-copy-finding]")) {
    trigger.addEventListener("click", () => copyFinding(trigger.dataset.copyFinding, trigger));
  }
  for (const trigger of document.querySelectorAll("[data-view-finding-dialog]")) {
    trigger.addEventListener("click", () => openDialog(trigger.dataset.viewFindingDialog, trigger));
  }
  for (const trigger of document.querySelectorAll("[data-close-finding-dialog]")) {
    trigger.addEventListener("click", () => closeDialog(trigger.dataset.closeFindingDialog));
  }
  const interactiveDialogs = [
    ...document.querySelectorAll("dialog[data-finding-dialog-id]"),
    manualDialog,
  ].filter(Boolean);
  for (const dialog of interactiveDialogs) {
    dialog.addEventListener("close", () => {
      const trigger = dialogTriggers.get(dialog.id);
      dialogTriggers.delete(dialog.id);
      trigger?.focus();
    });
    dialog.addEventListener("click", (event) => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      const outside = event.clientX < rect.left
        || event.clientX > rect.right
        || event.clientY < rect.top
        || event.clientY > rect.bottom;
      if (outside) closeDialog(dialog.id);
    });
  }

  return { copyFinding, openDialog, closeDialog };
}

function serializeForScript(value) {
  return JSON.stringify(value)
    .replace(/</gu, "\\u003c")
    .replace(/>/gu, "\\u003e")
    .replace(/&/gu, "\\u0026")
    .replace(/\u2028/gu, "\\u2028")
    .replace(/\u2029/gu, "\\u2029");
}

export function renderHtmlInteractionScript(language) {
  const labels = language === "zh-CN"
    ? {
        copy: "复制 AI 修复",
        copied: "已复制",
        copySuccess: "已复制，请粘贴到当前 Coding Agent 输入框。",
        manualCopy: "自动复制被阻止，请手动复制已选中的提示词。",
        missingPrompt: "这个问题没有可用的 AI 修复提示词。",
      }
    : {
        copy: "Copy AI Fix",
        copied: "Copied",
        copySuccess: "Copied. Paste into your coding agent input.",
        manualCopy: "Automatic copy was blocked. Copy the selected prompt manually.",
        missingPrompt: "No AI Fix prompt is available for this finding.",
      };
  return `<script id="harness-report-interactions">(${installHtmlReportInteractions.toString()})({document,navigator,location:globalThis.location,labels:${serializeForScript(labels)}});</script>`;
}
