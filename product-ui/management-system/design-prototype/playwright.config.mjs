import { defineConfig } from "@playwright/test";

export default defineConfig({
  expect: { timeout: 5_000 },
  fullyParallel: false,
  reporter: "list",
  testDir: "./tests",
  testMatch: "routing.browser.spec.mjs",
  use: {
    baseURL: "http://127.0.0.1:4177",
    browserName: "chromium",
    colorScheme: "dark",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 4177",
    port: 4177,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
