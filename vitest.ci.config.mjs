import { defineConfig, mergeConfig } from "vitest/config";

import baseConfig from "./vitest.config.mjs";

const reporters = [
  "default",
  ...(process.env.GITHUB_ACTIONS === "true" ? ["github-actions"] : []),
  ["junit", { outputFile: "test-results/vitest.junit.xml" }],
];

export default mergeConfig(baseConfig, defineConfig({
  test: { reporters },
}));
