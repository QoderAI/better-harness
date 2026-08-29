import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import i18n from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { describe, expect, it } from "vitest";
import type { ArtifactDescriptor } from "../src/contracts/artifact.js";
import { ArtifactInteractionPane } from "../src/app/artifacts/ArtifactInteractionPane.js";
import { resources } from "../src/app/i18n/resources.js";

const DIGEST = `sha256:${"a".repeat(64)}` as const;

const artifact: ArtifactDescriptor = {
  id: "artifact:demo",
  threadId: "artifact-thread:demo",
  label: "demo.canvas",
  size: 128,
  family: "images-diagrams",
  format: "canvas",
  backing: "data",
  revision: {
    id: DIGEST,
    digest: DIGEST,
    content: { uri: "/api/artifacts/demo/source", mediaType: "application/json", digest: DIGEST },
  },
  adapter: {
    id: "studio.canvas",
    version: "1",
    schemaId: "canvas-v1",
    snapshotId: DIGEST,
    snapshotUri: "/api/artifacts/demo/adapter",
  },
  interaction: { workspaceUri: "/api/artifacts/demo/interaction" },
  renderer: {
    id: "studio.canvas",
    label: "Canvas",
    provider: "studio",
    type: "html",
    status: "ready",
    bindingId: DIGEST,
  },
  capabilities: ["select", "steer"],
};

async function renderCollaboration(language: "en" | "zh-CN"): Promise<string> {
  const instance = i18n.createInstance();
  await instance.use(initReactI18next).init({
    resources,
    lng: language,
    fallbackLng: "en",
    defaultNS: "common",
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
  return renderToStaticMarkup(createElement(I18nextProvider, { i18n: instance }, createElement(ArtifactInteractionPane, {
    artifact,
    agentRunsEnabled: true,
    onSelectedAddressChange: () => undefined,
    onApplied: () => undefined,
  })));
}

describe("Studio component translations", () => {
  it("renders Artifact collaboration chrome from the active language", async () => {
    const en = await renderCollaboration("en");
    const zh = await renderCollaboration("zh-CN");

    expect(en).toContain("Human + Agent");
    expect(en).toContain("Collaboration");
    expect(zh).toContain("人工 + Agent");
    expect(zh).toContain("协作");
  });
});
