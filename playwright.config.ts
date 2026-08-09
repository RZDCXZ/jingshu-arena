import { defineConfig, devices } from "@playwright/test";

process.env.NO_PROXY = "*";
process.env.no_proxy = "*";

export default defineConfig({
  expect: {
    timeout: 5_000,
  },
  fullyParallel: true,
  reporter: process.env.CI ? "github" : "list",
  testDir: "./tests/e2e",
  use: {
    baseURL: "http://127.0.0.1:3000",
    launchOptions: {
      args: ["--no-proxy-server"],
    },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm --filter @jingshu/web dev",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    url: "http://127.0.0.1:3000",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
