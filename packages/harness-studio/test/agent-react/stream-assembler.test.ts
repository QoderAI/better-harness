import { describe, expect, it } from "vitest";
import { AgentStreamAssembler } from "../../src/agent-react/host/stream-assembler.js";

const ENTRY = "/view.tsx";
const descriptor = { id: "orders.dashboard", entry: ENTRY };

function sealedAssembler(modules: readonly [string, string][]): AgentStreamAssembler {
  const assembler = new AgentStreamAssembler(descriptor);
  for (const [path, text] of modules) {
    assembler.applyModulePatch({ path, text, mode: "replace" });
    assembler.sealModule(path);
  }
  return assembler;
}

describe("AgentStreamAssembler (AR-AC-1)", () => {
  it("assembles streamed patches into the sealed module text", () => {
    const assembler = new AgentStreamAssembler(descriptor);
    assembler.applyModulePatch({ path: ENTRY, text: "export default " });
    assembler.applyModulePatch({ path: ENTRY, text: "view;" });
    assembler.sealModule(ENTRY);

    const revision = assembler.commitArtifactRevision();
    expect(revision.modules).toEqual([{ path: ENTRY, text: "export default view;" }]);
  });

  it("refuses to commit while a module is still streaming", () => {
    const assembler = sealedAssembler([[ENTRY, "a"]]);
    assembler.applyModulePatch({ path: "/panel.tsx", text: "partial" });

    expect(assembler.unsealedModules()).toEqual(["/panel.tsx"]);
    expect(() => assembler.commitArtifactRevision()).toThrow(/unsealed/);
  });

  it("drops unsealed work on abort and keeps sealed modules", () => {
    const assembler = sealedAssembler([[ENTRY, "a"]]);
    assembler.applyModulePatch({ path: "/panel.tsx", text: "partial" });
    assembler.abortGeneration();

    expect(assembler.unsealedModules()).toEqual([]);
    expect(assembler.commitArtifactRevision().modules.map((module) => module.path)).toEqual([ENTRY]);
  });

  it("re-seals a module that is restated after sealing", () => {
    const assembler = sealedAssembler([[ENTRY, "first"]]);
    assembler.applyModulePatch({ path: ENTRY, text: "second", mode: "replace" });

    expect(() => assembler.commitArtifactRevision()).toThrow(/unsealed/);
    assembler.sealModule(ENTRY);
    expect(assembler.commitArtifactRevision().modules[0]?.text).toBe("second");
  });

  it("digests the same module bytes to the same Revision regardless of stream order", () => {
    const forward = sealedAssembler([[ENTRY, "a"], ["/panel.tsx", "b"]]).commitArtifactRevision();
    const reverse = sealedAssembler([["/panel.tsx", "b"], [ENTRY, "a"]]).commitArtifactRevision();

    expect(reverse.digest).toBe(forward.digest);
    expect(reverse.modules).toEqual(forward.modules);
  });

  it("digests different module bytes to a different Revision", () => {
    const original = sealedAssembler([[ENTRY, "a"]]).commitArtifactRevision();
    const changed = sealedAssembler([[ENTRY, "a "]]).commitArtifactRevision();

    expect(changed.digest).not.toBe(original.digest);
  });

  it("requires the descriptor's entry module", () => {
    const assembler = sealedAssembler([["/panel.tsx", "b"]]);

    expect(() => assembler.commitArtifactRevision()).toThrow(/entry module/);
  });

  it("rejects module paths that are not normalized POSIX paths", () => {
    const assembler = new AgentStreamAssembler(descriptor);

    expect(() => assembler.applyModulePatch({ path: "view.tsx", text: "" })).toThrow(/POSIX path/);
    expect(() => assembler.applyModulePatch({ path: "/a/../b.tsx", text: "" })).toThrow(/POSIX path/);
    expect(() => assembler.applyModulePatch({ path: "/a/..", text: "" })).toThrow(/POSIX path/);
    expect(() => assembler.applyModulePatch({ path: "/a/./b.tsx", text: "" })).toThrow(/POSIX path/);
    expect(() => assembler.applyModulePatch({ path: "/folder/", text: "" })).toThrow(/POSIX path/);
    expect(() => assembler.applyModulePatch({ path: "\\view.tsx", text: "" })).toThrow(/POSIX path/);
    expect(() => new AgentStreamAssembler({ id: "orders", entry: "/a/../view.tsx" })).toThrow(/POSIX path/);
  });

  it("owns and deeply freezes the committed Revision", () => {
    const callerDescriptor = { id: "orders.dashboard", entry: ENTRY };
    const assembler = new AgentStreamAssembler(callerDescriptor);
    callerDescriptor.id = "mutated";
    callerDescriptor.entry = "/other.tsx";
    assembler.applyModulePatch({ path: ENTRY, text: "a", mode: "replace" });
    assembler.sealModule(ENTRY);
    const revision = assembler.commitArtifactRevision();

    expect(Object.isFrozen(revision)).toBe(true);
    expect(Object.isFrozen(revision.modules)).toBe(true);
    expect(Object.isFrozen(revision.modules[0])).toBe(true);
    expect(Object.isFrozen(revision.descriptor)).toBe(true);
    expect(revision.descriptor).toEqual({ id: "orders.dashboard", entry: ENTRY });
    expect(() => {
      (revision.modules[0] as { text: string }).text = "mutated";
    }).toThrow(TypeError);
    expect(revision.modules[0]?.text).toBe("a");
  });
});
