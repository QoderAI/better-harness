import { describe, expect, it } from "vitest";
import { describeToolPayload } from "../src/app/tool-call-model.js";

describe("describeToolPayload", () => {
  it("formats structured arguments and promotes a useful path summary", () => {
    expect(describeToolPayload('{"path":"README.md","limit":20}', "empty")).toEqual({
      formatted: '{\n  "path": "README.md",\n  "limit": 20\n}',
      summary: "README.md",
      structured: true,
    });
  });

  it("keeps partial or plain-text payloads readable", () => {
    expect(describeToolPayload('{"path":', "empty")).toEqual({
      formatted: '{"path":',
      summary: '{"path":',
      structured: false,
    });
    expect(describeToolPayload("", "Waiting for result")).toEqual({
      formatted: "Waiting for result",
      summary: "Waiting for result",
      structured: false,
    });
  });
});
