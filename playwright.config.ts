import { defineConfig, devices } from "@playwright/test";

process.env.NO_PROXY = "*";
process.env.no_proxy = "*";

const webOrigin = process.env.JINGSHU_E2E_WEB_ORIGIN ?? "http://127.0.0.1:3000";
const webPort = new URL(webOrigin).port || "3000";

export default defineConfig({
  expect: {
    timeout: 5_000,
  },
  fullyParallel: true,
  reporter: process.env.CI ? "github" : "list",
  testDir: "./tests/e2e",
  use: {
    baseURL: webOrigin,
    launchOptions: {
      args: ["--no-proxy-server"],
    },
    trace: "retain-on-failure",
  },
  webServer: {
    command: `pnpm --filter @jingshu/web exec next dev --hostname 127.0.0.1 --port ${webPort}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    url: webOrigin,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
