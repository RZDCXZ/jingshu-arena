import { defineConfig, devices } from "@playwright/test";

process.env.NO_PROXY = "*";
process.env.no_proxy = "*";

const webOrigin = "http://127.0.0.1:3100";

export default defineConfig({
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  reporter: process.env.CI ? "github" : "list",
  testDir: "./tests/e2e",
  testMatch: "demo-story-real.spec.ts",
  timeout: 120_000,
  use: {
    actionTimeout: 10_000,
    baseURL: webOrigin,
    launchOptions: {
      args: ["--no-proxy-server"],
    },
    trace: "retain-on-failure",
  },
  workers: 1,
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
