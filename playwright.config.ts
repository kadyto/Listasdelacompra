import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";
export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  fullyParallel: false,
  timeout: 30000,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: {
      executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_PATH ??
        (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
    },
  },
  projects: [
    {
      name: "android",
      use: { ...devices["Pixel 7"], defaultBrowserType: "chromium" },
    },
    { name: "desktop", use: { viewport: { width: 1440, height: 1080 } } },
  ],
  webServer: {
    command: "node e2e/start-server.mjs",
    url: "http://127.0.0.1:3100/api/health",
    reuseExistingServer: false,
    timeout: 30000,
  },
});
