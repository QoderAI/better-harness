import path from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname),
    },
  },
  test: {
    include: ["test/**/*.test.{js,mjs,ts}"],
    // Upload integration tests spawn the real CLI and cross a loopback server;
    // keep their normal command deterministic on slower developer machines.
    testTimeout: 15_000,
  },
});
