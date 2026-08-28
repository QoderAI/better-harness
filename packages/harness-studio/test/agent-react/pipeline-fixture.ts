import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ArtifactRevision, BuildSnapshot, ModuleSource } from "../../src/agent-react/contracts/index.js";
import { AgentStreamAssembler } from "../../src/agent-react/host/stream-assembler.js";
import type { ArtifactBundleModule } from "../../src/agent-react/host/frames/local-frame-factory.js";
import type { TrustedRuntimePackage } from "../../src/agent-react/linker/allowed-packages.js";
import { digestParts } from "../../src/agent-react/host/digest.js";

const here = dirname(fileURLToPath(import.meta.url));
/** Bundles land inside the package so relative Bootstrap specifiers still resolve. */
export const BUNDLE_DIRECTORY = join(here, "..", ".artifacts");

/**
 * The Trusted Bootstrap for tests.
 *
 * The externals are relative specifiers from `test/.artifacts/`, which is the
 * whole reason bundles are written there: the linked bundle imports the same
 * `react` and the same runtime modules the Host uses, exactly as a browser build
 * would import a versioned Bootstrap URL.
 */
export const TEST_RUNTIME_PACKAGES: readonly TrustedRuntimePackage[] = Object.freeze([
  { specifier: "react", external: "react" },
  { specifier: "@studio/agent-react", external: "../../src/agent-react/runtime/index.js" },
  { specifier: "@studio/agent-react/jsx-dev-runtime", external: "../../src/agent-react/runtime/jsx-dev-runtime.js" },
]);

export function revisionOf(id: string, entry: string, modules: readonly ModuleSource[]): ArtifactRevision {
  const assembler = new AgentStreamAssembler({ id, entry });
  for (const module of modules) {
    assembler.applyModulePatch({ path: module.path, text: module.text, mode: "replace" });
    assembler.sealModule(module.path);
  }
  return assembler.commitArtifactRevision();
}

export async function writeBundle(snapshot: BuildSnapshot): Promise<string> {
  await mkdir(BUNDLE_DIRECTORY, { recursive: true });
  // Distinct file per bundle text so a second build of the same Revision is not
  // served from the module cache of the first.
  const name = `${digestParts([snapshot.buildDigest, snapshot.bundle]).slice(7, 23)}.mjs`;
  const path = join(BUNDLE_DIRECTORY, name);
  await writeFile(path, snapshot.bundle, "utf8");
  return path;
}

export async function loadBundle(snapshot: BuildSnapshot): Promise<ArtifactBundleModule> {
  const path = await writeBundle(snapshot);
  return (await import(pathToFileURL(path).href)) as ArtifactBundleModule;
}

export const ORDERS_VIEW_MODULE: ModuleSource = {
  path: "/view.tsx",
  text: `import { defineArtifactView, useArtifactAction, useArtifactState } from "@studio/agent-react";
import { StatRow } from "./stat-row.js";

interface Order {
  readonly id: string;
}

function OrderDashboard() {
  const [orders, setOrders] = useArtifactState<readonly Order[]>("/orders");
  const refresh = useArtifactAction("orders.refresh");
  const onRefresh = () => {
    setOrders(orders);
    void refresh({ reason: "user" });
  };
  return (
    <section className="dashboard">
      <h1>Orders</h1>
      <StatRow label="count" value={orders.length} />
      <button type="button" onClick={onRefresh}>Refresh</button>
    </section>
  );
}

export default defineArtifactView({
  id: "orders.dashboard",
  state: { "/orders": { schema: "orders", version: 2 } },
  capabilities: ["orders.read", "orders.refresh"],
  component: OrderDashboard,
});
`,
};

export const STAT_ROW_MODULE: ModuleSource = {
  path: "/stat-row.tsx",
  text: `interface StatRowProps {
  readonly label: string;
  readonly value: number;
}

export function StatRow({ label, value }: StatRowProps) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
`,
};

export const ORDERS_STATE_SCHEMA = {
  name: "orders",
  version: 2,
  initial: [] as readonly unknown[],
  validate: (value: unknown): true | string =>
    Array.isArray(value) ? true : "Orders state must be an array.",
};
