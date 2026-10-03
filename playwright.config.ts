import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";
process.env.UI_DB_PATH ??= resolve(`data/ui-test-${Date.now()}.db`);
export default defineConfig({
  testDir: "./tests",
  testMatch: "ui.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: { baseURL: "http://localhost:5173", trace: "retain-on-failure" },
  webServer: [
    {
      command: "node server/main.mjs",
      url: "http://localhost:3001/api/v1/status",
      reuseExistingServer: false,
      env: {
        DB_PATH: process.env.UI_DB_PATH,
        ORIGIN: "http://localhost:5173",
        PORT: "3001",
      },
      timeout: 60000,
    },
    {
      command: "npm run dev",
      url: "http://localhost:5173",
      reuseExistingServer: !process.env.CI,
      timeout: 60000,
    },
  ],
  projects: [
    {
      name: "chromium",
      use: {
        browserName: "chromium",
        ...(process.env.PLAYWRIGHT_CHANNEL
          ? { channel: process.env.PLAYWRIGHT_CHANNEL }
          : {}),
      },
    },
  ],
});
