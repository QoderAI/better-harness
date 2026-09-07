import { defineConfig } from "vitest/config";

// Tests that drive the staged Rust executables. Kept out of `vitest run` so a
// checkout without `npm run build:rust` is never asked to run them.
export default defineConfig({ test: {
  environment: "node", include: ["test/acp-rust.native.ts"],
  pool: "forks", testTimeout: 60_000,
} });
