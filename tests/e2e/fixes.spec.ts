import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { newHolder, loginViaUi, runCompanion } from "./helpers";

// Regression tests for bugs found by the owner's real-baw browser session on Nov 19, 2026 (local stack, labelled test double).
const OUT = `${process.env.SHOTS_DIR ?? "../../docs/evidence/screenshots"}/connect`;
mkdirSync(OUT, { recursive: true });
const shot = async (page: Page, name: string, ms = 600) => { await page.waitForTimeout(ms); await page.screenshot({ path: `${OUT}/${name}.png` }); };

async function connectLogin(page: Page, h: Awaited<ReturnType<typeof newHolder>>) {
  await page.goto("/welcome");
  const [resp] = await Promise.all([page.waitForResponse((r) => r.url().endsWith("/api/auth/connect/intents") && r.request().method() === "POST"), page.getByTestId("connect-start-login").click()]);
  const intent = await resp.json();
  expect((await runCompanion("login", intent.code, h)).code).toBe(0);
  await page.getByRole("button", { name: `Continue as ${h.agentName}` }).click();
}

test("thesis with contracts pending: a JSON 503 is a real answer (draft saved off-chain), never 'waking up'", async ({ page }) => {
  const h = await newHolder("thpend");
  await loginViaUi(page, h);
  // the production state: AtlasThesis not deployed → prepare answers 503 CONTRACTS_PENDING (JSON) from a running API
  await page.route("**/api/theses/*/prepare", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "CONTRACTS_PENDING", message: "ATLAS contracts are pending deployment on this chain." }) }));
  await page.goto("/compose");
  await page.getByRole("tab", { name: /thesis/i }).click();
  await page.locator("label:has-text('Target') + input").fill("100000");
  await page.locator("label:has-text('Invalidation') + input").fill("1");
  await page.getByPlaceholder("Title").fill("BNB holds into the weekend (e2e)");
  await page.getByPlaceholder(/one-line summary/i).fill("Spot bid absorbs supply; invalidated far below.");
  await page.getByRole("button", { name: /review & publish/i }).click();
  await expect(page.getByRole("heading", { name: "Draft saved (off-chain)" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/not\s*committed or scored/i)).toBeVisible();
  await expect(page.getByTestId("waking-banner")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(/waking up|briefly unavailable/i);
  await shot(page, "19-thesis-draft-contracts-pending");
});

test("profile setup: a new Connect account gets setup, keeps getting it until saved, then goes home", async ({ page }) => {
  const h = await newHolder("psetup");
  await connectLogin(page, h);
  await page.waitForURL("**/welcome/profile", { timeout: 20_000 });
  await expect(page.locator("aside nav[aria-label=Main]")).toHaveCount(0); // focused page, not the app shell
  await shot(page, "20-profile-setup-focused");
  // leave without saving → the app reminds, and the next sign-in goes to setup again
  await page.goto("/home");
  await expect(page.getByTestId("profile-setup-banner")).toBeVisible();
  await shot(page, "21-profile-setup-reminder");
  await page.context().clearCookies();
  await connectLogin(page, h);
  await page.waitForURL("**/welcome/profile", { timeout: 20_000 });
  await page.getByLabel("Display name").fill("Setup Tester");
  await page.getByRole("button", { name: /save and continue/i }).click();
  await page.waitForURL("**/home");
  await expect(page.getByTestId("profile-setup-banner")).toHaveCount(0);
  await page.context().clearCookies();
  await connectLogin(page, h);
  await page.waitForURL("**/home", { timeout: 20_000 });
});

test("full page load of /settings shows a loading state, never the signed-out UI", async ({ page }) => {
  const h = await newHolder("sload");
  await loginViaUi(page, h);
  let sawSignedOut = false;
  await page.route("**/api/auth/session", async (route) => { await new Promise((r) => setTimeout(r, 2500)); await route.fallback(); });
  const watch = setInterval(async () => {
    try { if (await page.getByText(/sign in to manage settings|sign in with agent id/i).count()) sawSignedOut = true; } catch { /* navigating */ }
  }, 150);
  await page.goto("/settings", { waitUntil: "commit" });
  await expect(page.getByTestId("session-loading")).toBeVisible();
  await expect(page.getByTestId("shell-session-loading")).toBeVisible();
  await shot(page, "22-settings-loading", 200);
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible({ timeout: 20_000 });
  clearInterval(watch);
  expect(sawSignedOut).toBe(false);
});

test("trending topics: a tasteful empty state instead of an empty card", async ({ page }) => {
  await page.route("**/api/explore?q=", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ topics: [], creators: [], posts: [] }) }));
  await page.goto("/markets");
  await expect(page.getByTestId("trending-empty")).toContainText("Nothing trending yet");
  await page.getByTestId("trending-topics").screenshot({ path: `${OUT}/23-trending-empty.png` });
});
