import assert from "node:assert/strict";
import test from "node:test";

import {
  installHtmlReportInteractions,
  renderHtmlInteractionScript,
} from "../scripts/harness-analysis/renderers/html-interactions.mjs";

const PROMPT = `/better-harness fix this issue

Fix <unsafe> & verify the finding-specific route.

## Validation

- Run npm test
- Confirm the exact prompt is preserved`;

const LABELS = {
  copy: "Copy AI Fix",
  copied: "Copied",
  copySuccess: "Copied. Paste into the Codex input.",
  manualCopy: "Automatic copy was blocked. Copy the selected prompt manually.",
  missingPrompt: "No AI Fix prompt is available for this finding.",
};

class FakeClassList {
  constructor() {
    this.values = new Set(["no-js"]);
  }

  remove(value) {
    this.values.delete(value);
  }

  contains(value) {
    return this.values.has(value);
  }
}

class FakeElement {
  constructor({ id = "", dataset = {}, textContent = "", rect = { left: 10, right: 200, top: 10, bottom: 200 } } = {}) {
    this.id = id;
    this.dataset = { ...dataset };
    this.textContent = textContent;
    this.rect = rect;
    this.listeners = new Map();
    this.attributes = new Map();
    this.style = {};
    this.value = "";
    this.open = false;
    this.focused = false;
    this.selected = false;
    this.removed = false;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  async dispatch(type, overrides = {}) {
    const event = { target: this, clientX: 50, clientY: 50, ...overrides };
    const results = (this.listeners.get(type) ?? []).map((listener) => listener(event));
    await Promise.all(results.filter((result) => result && typeof result.then === "function"));
  }

  setAttribute(name, value) {
    this.attributes.set(name, value);
  }

  focus() {
    this.focused = true;
  }

  select() {
    this.selected = true;
  }

  showModal() {
    this.open = true;
  }

  close() {
    this.open = false;
    for (const listener of this.listeners.get("close") ?? []) listener({ target: this });
  }

  getBoundingClientRect() {
    return this.rect;
  }

  remove() {
    this.removed = true;
  }
}

function interactionFixture({ clipboardWrite, legacyCopyResult = true } = {}) {
  const reportData = new FakeElement({
    id: "harness-report-data",
    textContent: JSON.stringify({ findings: [{ id: "finding-a", aiFixPrompt: PROMPT }] }),
  });
  const status = new FakeElement({ id: "copy-status" });
  const manualDialog = new FakeElement({ id: "manual-copy-dialog" });
  const manualText = new FakeElement({ id: "manual-copy-text" });
  const findingDialog = new FakeElement({
    id: "finding-dialog-1",
    dataset: { findingDialogId: "finding-a" },
  });
  const copyButton = new FakeElement({
    dataset: { copyFinding: "finding-a" },
    textContent: LABELS.copy,
  });
  const viewButton = new FakeElement({
    dataset: { viewFindingDialog: "finding-dialog-1" },
    textContent: "View details",
  });
  const closeButton = new FakeElement({
    dataset: { closeFindingDialog: "finding-dialog-1" },
    textContent: "Close",
  });
  const manualCloseButton = new FakeElement({
    dataset: { closeFindingDialog: "manual-copy-dialog" },
    textContent: "Close",
  });
  const created = [];
  const scheduled = [];
  const byId = new Map([
    [reportData.id, reportData],
    [status.id, status],
    [manualDialog.id, manualDialog],
    [manualText.id, manualText],
    [findingDialog.id, findingDialog],
  ]);
  const selectors = new Map([
    ["[data-copy-finding]", [copyButton]],
    ["[data-view-finding-dialog]", [viewButton]],
    ["[data-close-finding-dialog]", [closeButton, manualCloseButton]],
    ["dialog[data-finding-dialog-id]", [findingDialog]],
  ]);
  const document = {
    documentElement: { classList: new FakeClassList() },
    body: {
      append(element) {
        created.push(element);
      },
    },
    getElementById(id) {
      return byId.get(id) ?? null;
    },
    querySelectorAll(selector) {
      return selectors.get(selector) ?? [];
    },
    createElement() {
      return new FakeElement();
    },
    execCommand(command) {
      assert.equal(command, "copy");
      return legacyCopyResult;
    },
  };
  const writes = [];
  const navigator = clipboardWrite === undefined
    ? {}
    : {
        clipboard: {
          async writeText(value) {
            writes.push(value);
            return clipboardWrite(value);
          },
        },
      };
  const controller = installHtmlReportInteractions({
    document,
    navigator,
    labels: LABELS,
    schedule(callback) {
      scheduled.push(callback);
    },
  });
  return {
    controller,
    document,
    status,
    manualDialog,
    manualText,
    findingDialog,
    copyButton,
    viewButton,
    closeButton,
    manualCloseButton,
    created,
    scheduled,
    writes,
  };
}

test("copy action writes the exact finding prompt and reports success", async () => {
  const fixture = interactionFixture({ clipboardWrite: async () => undefined });

  await fixture.copyButton.dispatch("click");

  assert.deepEqual(fixture.writes, [PROMPT]);
  assert.equal(fixture.status.textContent, LABELS.copySuccess);
  assert.equal(fixture.status.dataset.state, "success");
  assert.equal(fixture.copyButton.textContent, LABELS.copied);
  assert.equal(fixture.manualDialog.open, false);
  assert.equal(fixture.document.documentElement.classList.contains("no-js"), false);
  fixture.scheduled[0]();
  assert.equal(fixture.copyButton.textContent, LABELS.copy);
});

test("copy action uses the local fallback when Clipboard API rejects", async () => {
  const fixture = interactionFixture({
    clipboardWrite: async () => {
      throw new Error("denied");
    },
    legacyCopyResult: true,
  });

  await fixture.copyButton.dispatch("click");

  assert.deepEqual(fixture.writes, [PROMPT]);
  assert.equal(fixture.created.length, 1);
  assert.equal(fixture.created[0].value, PROMPT);
  assert.equal(fixture.created[0].selected, true);
  assert.equal(fixture.created[0].removed, true);
  assert.equal(fixture.status.dataset.state, "success");
  assert.equal(fixture.manualDialog.open, false);
});

test("copy action exposes selected manual text when all copy paths fail", async () => {
  const fixture = interactionFixture({
    clipboardWrite: async () => {
      throw new Error("denied");
    },
    legacyCopyResult: false,
  });

  await fixture.copyButton.dispatch("click");

  assert.equal(fixture.manualDialog.open, true);
  assert.equal(fixture.manualText.value, PROMPT);
  assert.equal(fixture.manualText.focused, true);
  assert.equal(fixture.manualText.selected, true);
  assert.equal(fixture.status.textContent, LABELS.manualCopy);
  assert.equal(fixture.status.dataset.state, "error");
  assert.notEqual(fixture.status.textContent, LABELS.copySuccess);

  await fixture.manualCloseButton.dispatch("click");
  assert.equal(fixture.manualDialog.open, false);
  assert.equal(fixture.copyButton.focused, true);
});

test("detail actions stay bound to one dialog and restore trigger focus", async () => {
  const fixture = interactionFixture();

  await fixture.viewButton.dispatch("click");
  assert.equal(fixture.findingDialog.open, true);

  await fixture.closeButton.dispatch("click");
  assert.equal(fixture.findingDialog.open, false);
  assert.equal(fixture.viewButton.focused, true);

  fixture.viewButton.focused = false;
  await fixture.viewButton.dispatch("click");
  await fixture.findingDialog.dispatch("click", { target: fixture.findingDialog, clientX: 0, clientY: 0 });
  assert.equal(fixture.findingDialog.open, false);
  assert.equal(fixture.viewButton.focused, true);
});

test("rendered interaction controller localizes labels without host coupling", () => {
  const script = renderHtmlInteractionScript("zh-CN");

  assert.match(script, /id="harness-report-interactions"/u);
  assert.match(script, /复制 AI 修复/u);
  assert.match(script, /已复制，请粘贴到 Codex 输入框。/u);
  assert.doesNotMatch(script, /window\.openai|codex:\/\/|chatgpt:\/\//iu);
});
