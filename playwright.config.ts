import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 3102);
const baseURL = `http://127.0.0.1:${port}`;
const authFile = path.join(process.cwd(), ".e2e", "auth.json");
const chromiumExecutablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim();
const devScript = process.env.E2E_USE_WEBPACK === "1" ? "dev:webpack" : "dev";

export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ["list"],
    ["html", { open: "never" }],
  ],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: chromiumExecutablePath ? "off" : "retain-on-failure",
    launchOptions: chromiumExecutablePath
      ? { executablePath: chromiumExecutablePath }
      : undefined,
  },
  webServer: {
    command: `npm run ${devScript} -- --hostname 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATA_DIR: path.join(process.cwd(), ".e2e", "data"),
      AUTH_MODE: "local",
      NEXT_PUBLIC_AUTH_MODE: "local",
      AUTH_SECRET: "haitun-e2e-auth-secret-2026",
      AUTH_URL: baseURL,
      AUTH_TRUST_HOST: "true",
      E2E_MODE: "1",
      ARK_API_KEY: "e2e-placeholder-ark-key",
      GENERATION_MAX_ACTIVE_PER_USER: "0",
      GENERATION_MAX_DAILY_PER_USER: "0",
      GENERATION_MAX_DAILY_PER_PROJECT: "0",
    },
  },
  projects: [
    {
      name: "setup",
      testMatch: /.*\.setup\.ts/,
      retries: 0,
    },
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        storageState: authFile,
      },
      dependencies: ["setup"],
      testIgnore: /.*\.setup\.ts/,
    },
  ],
});
