import { defineConfig } from "vitest/config";

export default defineConfig({ test: {
  environment: "node", include: ["test/agent-react/rust-oxc.native.ts"],
  pool: "forks", testTimeout: 30_000,
} });
