import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test/browser",
  outputDir: "./test-results",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3410",
    browserName: "chromium",
    colorScheme: "light",
  },
  webServer: {
    command: "npm run start",
    url: "http://127.0.0.1:3410",
    reuseExistingServer: true,
  },
});
