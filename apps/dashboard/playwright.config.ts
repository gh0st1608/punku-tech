import { defineConfig, devices } from "@playwright/test";

const dashboardPort = process.env.AIEF_E2E_PORT ?? "5173";
const dashboardUrl = `http://127.0.0.1:${dashboardPort}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ["list"],
    ["html", { outputFolder: "../../artifacts/qa/playwright-report", open: "never" }],
    ["junit", { outputFile: "../../artifacts/qa/playwright-results.xml" }],
  ],
  outputDir: "../../artifacts/qa/playwright-results",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: dashboardUrl,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `npm --workspace @aief/dashboard run dev -- --host 127.0.0.1 --port ${dashboardPort} --strictPort`,
    url: dashboardUrl,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
