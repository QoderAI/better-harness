import path from "node:path";

import { defineConfig } from "@playwright/test";

const uploads = path.join(import.meta.dirname, "test-results", "uploads");

export default defineConfig({
  testDir: "./test/browser",
  outputDir: "./test-results",
  globalSetup: "./test/browser/global-setup.mjs",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3410",
    browserName: "chromium",
    colorScheme: "light",
  },
  webServer: {
    command: "npm run start",
    url: "http://127.0.0.1:3410",
    // The suite asserts on evidence written to its own store, so it always
    // starts a server with that store configured instead of reusing one.
    reuseExistingServer: false,
    env: {
      BETTER_HARNESS_UPLOADS: uploads,
      // The readiness probe loads the page before globalSetup applies its
      // fixture. Disable reuse so the browser observes that accepted evidence.
      BETTER_HARNESS_REFRESH_MS: "0",
    },
  },
});
