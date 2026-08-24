import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    exclude: ["test/fixtures/**", "test/support/**"],
    hookTimeout: 120_000,
    include: ["test/**/*.test.mjs"],
    pool: "forks",
    testTimeout: 120_000,
    teardownTimeout: 30_000,
  },
});
