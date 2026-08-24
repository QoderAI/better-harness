import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { MarkdownArtifactPayload, MarkdownBlock, MarkdownInline } from "../src/artifact-model.js";
import { describeArtifactCatalog, indexArtifactDirectory } from "../src/server/artifact-catalog.js";
import {
  MARKDOWN_ARTIFACT_ADAPTER,
  parseMarkdown,
  resetMarkdownArtifactCache,
} from "../src/server/markdown-artifact-adapter.js";
import { resolveArtifactPlugin } from "../src/server/artifact-plugin-registry.js";

const temporary: string[] = [];

afterEach(async () => {
  resetMarkdownArtifactCache();
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function markdownDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "studio-markdown-"));
  temporary.push(directory);
  return directory;
}

async function adaptDocument(directory: string, label: string) {
  const index = await indexArtifactDirectory(directory, { includeDigests: true });
  const entry = index.entries.find((candidate) => candidate.label === label)!;
  const catalog = describeArtifactCatalog(index, (candidate) => resolveArtifactPlugin(candidate));
  const descriptor = catalog.artifacts.find((candidate) => candidate.id === entry.id)!;
  const snapshot = await MARKDOWN_ARTIFACT_ADAPTER.adapt({ entry, descriptor });
  return { entry, descriptor, snapshot, payload: snapshot.payload as MarkdownArtifactPayload };
}

function blockKinds(blocks: readonly MarkdownBlock[]): string[] {
  return blocks.map((block) => block.kind === "heading" ? `heading${block.level}` : block.kind);
}

function inlineKinds(nodes: readonly MarkdownInline[]): string[] {
  return nodes.map((node) => node.kind === "text" ? `text:${node.text}` : node.kind);
}

describe("Markdown adapter", () => {
  it("parses the block constructs Studio renders", () => {
    const parsed = parseMarkdown([
      "# Run report",
      "",
      "A paragraph.",
      "",
      "## Findings",
      "",
      "1. First",
      "2. Second",
      "   - nested",
      "",
      "- [ ] open task",
      "- [x] done task",
      "",
      "> quoted **text**",
      "",
      "| Name | Count | Note |",
      "| :--- | ----: | :--: |",
      "| alpha | 12 | ok |",
      "| beta | 3 |",
      "",
      "```ts",
      "const value = 1;",
      "```",
      "",
      "---",
      "",
      "Underlined title",
      "================",
    ].join("\n"));

    expect(blockKinds(parsed.blocks)).toEqual([
      "heading1", "paragraph", "heading2", "list", "list", "quote", "table", "code", "thematicBreak", "heading1",
    ]);

    const ordered = parsed.blocks[3]!;
    expect(ordered.kind === "list" && ordered.ordered).toBe(true);
    expect(ordered.kind === "list" && blockKinds(ordered.items[1]!.blocks)).toEqual(["paragraph", "list"]);

    const tasks = parsed.blocks[4]!;
    expect(tasks.kind === "list" && tasks.items.map((item) => item.checked)).toEqual([false, true]);

    const table = parsed.blocks[6]!;
    expect(table.kind === "table" && table.alignments).toEqual(["left", "right", "center"]);
    // A ragged row must be padded rather than allowed to shift columns.
    expect(table.kind === "table" && table.rows.map((row) => row.length)).toEqual([3, 3]);

    const code = parsed.blocks[7]!;
    expect(code.kind === "code" && code.language).toBe("ts");
    expect(code.kind === "code" && code.text).toBe("const value = 1;");

    const headings = parsed.blocks.filter((block) => block.kind === "heading");
    expect(headings.map((heading) => heading.kind === "heading" && heading.id)).toEqual(["run-report", "findings", "underlined-title"]);
  });

  it("keeps leading front matter out of the heading structure", () => {
    const parsed = parseMarkdown(["---", "title: Report", "status: draft", "---", "", "# Body"].join("\n"));
    expect(blockKinds(parsed.blocks)).toEqual(["code", "heading1"]);
    const front = parsed.blocks[0]!;
    expect(front.kind === "code" && front.language).toBe("yaml");
    expect(front.kind === "code" && front.text).toBe("title: Report\nstatus: draft");
  });

  it("renders inline emphasis and code without treating snake_case as emphasis", () => {
    const parsed = parseMarkdown("Use **bold**, *italic*, ~~gone~~, `code`, and some_snake_case_name here.");
    const paragraph = parsed.blocks[0]!;
    expect(paragraph.kind).toBe("paragraph");
    expect(paragraph.kind === "paragraph" && inlineKinds(paragraph.children)).toEqual([
      "text:Use ", "strong", "text:, ", "emphasis", "text:, ", "strike", "text:, ", "code",
      "text:, and some_snake_case_name here.",
    ]);
  });

  it("links only schemes a reader can safely follow", () => {
    const parsed = parseMarkdown([
      "[safe](https://example.com/page) [mail](mailto:someone@example.com)",
      "[script](javascript:alert(1)) [data](data:text/html,<script>) [relative](./sibling.md) [anchor](#findings)",
    ].join("\n"));
    const links = collectInline(parsed.blocks).filter((node) => node.kind === "link");
    expect(links.map((link) => link.kind === "link" && link.href)).toEqual([
      "https://example.com/page",
      "mailto:someone@example.com",
      "#findings",
    ]);
    // A blocked target must survive as its own label rather than disappearing.
    const text = collectInline(parsed.blocks).filter((node) => node.kind === "text").map((node) => node.kind === "text" && node.text);
    expect(text).toContain("script");
    expect(text).toContain("data");
    expect(text).toContain("relative");
    expect(parsed.diagnostics.map((diagnostic) => diagnostic.code)).toContain("MARKDOWN_LINK_SCHEME_BLOCKED");
    expect(parsed.diagnostics.map((diagnostic) => diagnostic.code)).toContain("MARKDOWN_LINK_RELATIVE");
  });

  it("carries embedded HTML as source text instead of markup", () => {
    const parsed = parseMarkdown([
      '<div onclick="steal()">block</div>',
      "",
      'A paragraph with <img src=x onerror="steal()"> inline.',
    ].join("\n"));
    expect(blockKinds(parsed.blocks)).toEqual(["rawHtml", "paragraph"]);
    const raw = parsed.blocks[0]!;
    expect(raw.kind === "rawHtml" && raw.text).toContain("onclick");
    const inline = parsed.blocks[1]!;
    expect(inline.kind === "paragraph" && inline.children.every((node) => node.kind === "text")).toBe(true);
    expect(parsed.diagnostics.map((diagnostic) => diagnostic.code)).toContain("MARKDOWN_HTML_NOT_RENDERED");
  });

  it("serves images beside the document and declines everything else", async () => {
    const directory = await markdownDirectory();
    const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
    await writeFile(join(directory, "diagram.png"), png);
    await mkdir(join(directory, "nested"), { recursive: true });
    await writeFile(join(directory, "nested", "inner.png"), png);
    await writeFile(join(directory, "report.md"), [
      "# Images",
      "",
      "![local](./diagram.png)",
      "![nested](./nested/inner.png)",
      "![remote](https://example.invalid/pixel.png)",
      "![escape](../outside.png)",
      "![missing](./absent.png)",
    ].join("\n"), "utf8");

    const { snapshot, payload, entry, descriptor } = await adaptDocument(directory, "report.md");
    const images = collectInline(payload.blocks).filter((node) => node.kind === "image");
    expect(images.map((image) => image.kind === "image" && image.alt)).toEqual(["local", "nested", "remote", "escape", "missing"]);
    // Both local files resolve to the same bytes, so they share one resource.
    expect(snapshot.resources).toHaveLength(1);
    expect(images.filter((image) => image.kind === "image" && image.resourceId !== undefined)).toHaveLength(2);
    expect(snapshot.resources[0]!.uri).toContain(`/revisions/${descriptor.revision.digest.slice(7)}/resources/media-`);

    const codes = snapshot.diagnostics.map((diagnostic) => diagnostic.code);
    expect(codes).toContain("MARKDOWN_IMAGE_REMOTE");
    expect(codes).toContain("MARKDOWN_IMAGE_OUTSIDE");
    expect(codes).toContain("MARKDOWN_IMAGE_MISSING");

    const bytes = await MARKDOWN_ARTIFACT_ADAPTER.readResource!({ entry, descriptor }, snapshot.resources[0]!.id);
    expect(bytes?.mediaType).toBe("image/png");
    expect(Buffer.from(bytes!.bytes)).toEqual(png);
    expect(await MARKDOWN_ARTIFACT_ADAPTER.readResource!({ entry, descriptor }, "../secret")).toBeUndefined();
  });

  it("publishes a nested heading outline and a markdown renderer through the catalog", async () => {
    const directory = await markdownDirectory();
    await writeFile(join(directory, "guide.md"), [
      "# Guide",
      "## Setup",
      "### Install",
      "## Usage",
    ].join("\n"), "utf8");

    const { descriptor, snapshot } = await adaptDocument(directory, "guide.md");
    expect(descriptor).toMatchObject({
      format: "md",
      backing: "data",
      family: "source-text",
      renderer: { id: "studio.markdown", type: "native", status: "ready" },
      adapter: { id: "studio.markdown-commonmark", schemaId: "markdown/v1" },
    });
    expect(descriptor.capabilities).toEqual(["navigate", "outline"]);
    expect(snapshot.structure).toHaveLength(1);
    expect(snapshot.structure[0]!.children?.map((child) => child.label)).toEqual(["Setup", "Usage"]);
    expect(snapshot.structure[0]!.children?.[0]!.children?.map((child) => child.label)).toEqual(["Install"]);
    expect(snapshot.semanticIndex.map((row) => row.kind)).toEqual(["heading-1", "heading-2", "heading-3", "heading-2"]);
  });
});

function collectInline(blocks: readonly MarkdownBlock[]): MarkdownInline[] {
  const found: MarkdownInline[] = [];
  const walkInline = (nodes: readonly MarkdownInline[]): void => {
    for (const node of nodes) {
      found.push(node);
      if (node.kind === "emphasis" || node.kind === "strong" || node.kind === "strike" || node.kind === "link") {
        walkInline(node.children);
      }
    }
  };
  for (const block of blocks) {
    if (block.kind === "heading" || block.kind === "paragraph") walkInline(block.children);
    if (block.kind === "quote") found.push(...collectInline(block.blocks));
    if (block.kind === "list") for (const item of block.items) found.push(...collectInline(item.blocks));
    if (block.kind === "table") {
      for (const cell of block.head) walkInline(cell);
      for (const row of block.rows) for (const cell of row) walkInline(cell);
    }
  }
  return found;
}
