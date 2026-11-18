import { defineConfig, devices } from "@playwright/test";

const channel = process.env.PW_CHANNEL ?? (process.env.CI ? undefined : "chrome");
export default defineConfig({
  testDir: ".",
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: process.env.WEB_URL ?? "http://localhost:3000", trace: "retain-on-failure", ...(channel ? { channel } : {}) },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, ...(channel ? { channel } : {}) }, grepInvert: /@mobile/ },
    { name: "mobile", use: { ...devices["Pixel 7"], ...(channel ? { channel } : {}) }, grep: /@mobile/ },
  ],
});
