export function installHtmlReportInteractions({
  document,
  navigator,
  labels,
  schedule = (callback, delay) => globalThis.setTimeout(callback, delay),
}) {
  document.documentElement.classList.remove("no-js");

  const reportDataElement = document.getElementById("harness-report-data");
  const reportData = reportDataElement
    ? JSON.parse(reportDataElement.textContent || "{}")
    : {};
  const findings = new Map(
    (Array.isArray(reportData.findings) ? reportData.findings : [])
      .map((finding) => [String(finding?.id ?? ""), finding]),
  );
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
    const prompt = findings.get(String(findingId))?.aiFixPrompt;
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

    if (manualText) {
      manualText.value = prompt;
      manualText.focus();
      manualText.select();
    }
    if (manualDialog && typeof manualDialog.showModal === "function") {
      manualDialog.showModal();
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
  for (const dialog of document.querySelectorAll("dialog[data-finding-dialog-id]")) {
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
        copySuccess: "已复制，请粘贴到 Codex 输入框。",
        manualCopy: "自动复制被阻止，请手动复制已选中的提示词。",
        missingPrompt: "这个问题没有可用的 AI 修复提示词。",
      }
    : {
        copy: "Copy AI Fix",
        copied: "Copied",
        copySuccess: "Copied. Paste into the Codex input.",
        manualCopy: "Automatic copy was blocked. Copy the selected prompt manually.",
        missingPrompt: "No AI Fix prompt is available for this finding.",
      };
  return `<script id="harness-report-interactions">(${installHtmlReportInteractions.toString()})({document,navigator,labels:${serializeForScript(labels)}});</script>`;
}
