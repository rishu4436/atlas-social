import { test, expect, type Page, type Browser } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { newHolder, loginViaUi, runCompanion } from "./helpers";

// ATLAS Connect on the local stack: real API + web + local chain. The user's Agentic Wallet is played by the labelled
// baw TEST DOUBLE driven by the real atlas-baw-connect companion. Nothing here touches BSC mainnet.
const OUT = `${process.env.SHOTS_DIR ?? "../../docs/evidence/screenshots"}/connect`;
mkdirSync(OUT, { recursive: true });
const shot = async (page: Page, name: string, ms = 700) => { await page.waitForTimeout(ms); await page.screenshot({ path: `${OUT}/${name}.png` }); };

async function startConnect(page: Page) {
  await page.goto("/welcome");
  const [resp] = await Promise.all([page.waitForResponse((r) => r.url().endsWith("/api/auth/connect/intents") && r.request().method() === "POST"), page.getByTestId("connect-start-login").click()]);
  const intent = await resp.json();
  await expect(page.getByTestId("connect-code")).toHaveText(intent.code);
  return intent;
}

test("new user: Continue with Binance Agentic Wallet → companion handoff → confirm → profile setup → separate states", async ({ page }) => {
  const h = await newHolder("cnew");
  await page.goto("/welcome");
  await expect(page.getByTestId("connect-start-login")).toBeVisible();
  await expect(page.getByText(/qr code|pairing code/i).filter({ hasNotText: /no QR or pairing-code login/i })).toHaveCount(0);
  await shot(page, "01-welcome-connect");
  const intent = await startConnect(page);
  await expect(page.getByRole("tab", { name: /your ai agent/i })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText(intent.code, { exact: false }).first()).toBeVisible();
  await shot(page, "02-handoff-agent-instruction");
  await page.getByRole("tab", { name: /terminal/i }).click();
  await expect(page.getByText(/atlas-baw-connect/).first()).toBeVisible();
  await shot(page, "03-handoff-terminal-companion");
  await page.getByRole("tab", { name: /mcp/i }).click();
  await shot(page, "04-handoff-mcp");
  const run = await runCompanion("login", intent.code, h);
  expect(run.out).toContain("ATLAS verified the signature");
  expect(run.code).toBe(0);
  await expect(page.getByTestId("connect-approved")).toContainText(h.agentName);
  await expect(page.getByTestId("connect-approved")).toContainText(h.account.address);
  await shot(page, "05-approved-confirm-agent-id");
  await page.getByRole("button", { name: `Continue as ${h.agentName}` }).click();
  await page.waitForURL("**/welcome/profile", { timeout: 20_000 });
  await expect(page.getByTestId("identity-states")).toContainText("Agent ID verified");
  await expect(page.getByTestId("identity-states")).toContainText(/left/);
  await shot(page, "06-profile-setup-new-user", 900);
  await page.getByLabel("Bio").fill("BNB levels and on-chain flows (e2e)");
  await page.getByRole("button", { name: "#bnb" }).click();
  await page.getByRole("button", { name: /save and continue/i }).click();
  await page.waitForURL("**/home");
  await page.goto("/settings?tab=security");
  await expect(page.getByTestId("identity-states")).toContainText("Financial actions");
  await expect(page.getByTestId("identity-states")).toContainText("per transaction");
  await shot(page, "07-settings-separate-states", 900);
});

test("existing user keeps the same account; the code cannot be redeemed by another browser or twice", async ({ page, browser }) => {
  const h = await newHolder("cold");
  await loginViaUi(page, h);
  const before = await (await page.request.get("/api/auth/session")).json();
  await page.context().clearCookies();
  const intent = await startConnect(page);
  // another browser (no binding cookie) cannot poll or redeem this intent
  const other = await browser.newContext();
  const op = await other.newPage();
  await op.goto("/welcome");
  const poll = await op.request.get(`/api/auth/connect/intents/${intent.intentId}`);
  expect(poll.status()).toBe(403);
  expect((await poll.json()).error).toBe("CONNECT_WRONG_BROWSER");
  expect((await runCompanion("login", intent.code, h)).code).toBe(0);
  const steal = await op.request.post(`/api/auth/connect/intents/${intent.intentId}/redeem`, { data: { confirmAgentName: h.agentName }, headers: { origin: "http://localhost:3000" } });
  expect(steal.status()).toBe(403);
  await other.close();
  await expect(page.getByTestId("connect-approved")).toBeVisible();
  await page.getByRole("button", { name: `Continue as ${h.agentName}` }).click();
  await page.waitForURL("**/home", { timeout: 20_000 });
  const after = await (await page.request.get("/api/auth/session")).json();
  expect(after.userId).toBe(before.userId);
  expect(after.states.wallet.via).toBe("connect");
  // the handoff cannot run again on a used code
  const again = await runCompanion("login", intent.code, h);
  expect(again.out).toMatch(/CONNECT_ALREADY_USED/);
});

test("declining at the approval prompt signs nothing; 953004 shows the honest fallback", async ({ page }) => {
  const h = await newHolder("cfail");
  const intent = await startConnect(page);
  const no = await runCompanion("login", intent.code, h, { answer: "no" });
  expect(no.out).toContain("Cancelled. Nothing was signed or sent.");
  await expect(page.getByTestId("connect-status")).toContainText(/approval/i);
  const r = await runCompanion("login", intent.code, h, { env: { FAKE_BAW_FAIL: "sign-message_preview:953004" } });
  expect(r.out).toContain("issues/400");
  await expect(page.getByTestId("connect-953004")).toBeVisible();
  await expect(page.getByTestId("connect-953004")).toContainText("binance-skills-hub#400");
  await shot(page, "08-953004-honest-fallback");
});

test("ATLAS Pay via Connect: browser prepares, companion previews + executes, ATLAS verifies the tx, receipt from the chain", async ({ browser }) => {
  const payee = await newHolder("cpee");
  const payeeCtx = await browser.newContext(); const pp = await payeeCtx.newPage(); await loginViaUi(pp, payee);
  const payer = await newHolder("cpay");
  const ctx = await browser.newContext(); const page = await ctx.newPage(); await loginViaUi(page, payer);
  await page.goto(`/u/${payee.agentName}`);
  await page.getByTestId("profile-pay").click();
  const sheet = page.getByTestId("send-sheet");
  await sheet.getByTestId("pay-amount").fill("0.01");
  await sheet.getByTestId("pay-review").click();
  await expect(sheet.getByTestId("pay-connect-start")).toBeEnabled();
  const [resp] = await Promise.all([page.waitForResponse((r) => r.url().endsWith("/api/pay/handoff")), sheet.getByTestId("pay-connect-start").click()]);
  const handoff = await resp.json();
  await expect(sheet.getByTestId("pay-connect-address")).toHaveAttribute("data-address", payee.account.address);
  await expect(sheet.getByTestId("pay-connect-summary")).toContainText("0.01");
  await shot(page, "09-pay-connect-review");
  const run = await runCompanion("pay", handoff.code, payer);
  expect(run.out).toContain(payee.account.address); // full address read back to the user
  expect(run.out).toContain("matches the reviewed step");
  // audit F3: verified is not paid; the companion prints the stage and never claims the payment is done
  expect(run.out).toContain("NOT paid yet");
  await expect(sheet.getByTestId("pay-connect-verified")).toBeVisible({ timeout: 20_000 });
  await shot(page, "10-pay-connect-verified");
  await expect(sheet.getByTestId("pay-receipt-found")).toBeVisible({ timeout: 60_000 });
  await shot(page, "11-pay-receipt-indexed");
  await ctx.close(); await payeeCtx.close();
});

test("@mobile ATLAS Connect on a phone (reduced motion)", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, reducedMotion: "reduce", isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const h = await newHolder("cmob");
  await page.goto("/welcome");
  await shot(page, "12-mobile-welcome");
  const intent = await startConnect(page);
  await shot(page, "13-mobile-handoff");
  expect((await runCompanion("login", intent.code, h)).code).toBe(0);
  await expect(page.getByTestId("connect-approved")).toBeVisible();
  await shot(page, "14-mobile-approved");
  await ctx.close();
});

const HTML_503 = { status: 503, contentType: "text/html", body: "<!DOCTYPE html><html><body>Service waking up</body></html>" };

test("cold start: a sleeping API (HTML 503) shows 'Waking up ATLAS servers…' and Connect retries, never a raw parse error", async ({ page }) => {
  let blocked = 0;
  await page.route("**/api/auth/connect/intents", async (route) => {
    if (route.request().method() === "POST" && blocked < 3) { blocked++; return route.fulfill(HTML_503); }
    return route.fallback();
  });
  await page.goto("/welcome");
  await page.getByTestId("connect-start-login").click();
  await expect(page.getByTestId("waking-banner")).toContainText("Waking up ATLAS servers… (up to a minute)");
  await expect(page.getByTestId("connect-waking")).toBeVisible();
  await shot(page, "15-waking-up-servers", 300);
  await expect(page.getByTestId("connect-code")).toHaveText(/^ATC-[0-9A-Z]{26}$/, { timeout: 30_000 });
  await expect(page.getByTestId("waking-banner")).toHaveCount(0);
  expect(blocked).toBe(3);
  await expect(page.locator("body")).not.toContainText(/Unexpected token|is not valid JSON|DOCTYPE/);
});

test("cold start on a read page: GET retries through HTML/502 and the page loads", async ({ page }) => {
  let n = 0;
  await page.route("**/api/config", async (route) => (n++ < 2 ? route.fulfill({ ...HTML_503, status: 502 }) : route.fallback()));
  const warm: string[] = [];
  page.on("request", (r) => { if (r.url().endsWith("/api/health")) warm.push(r.url()); });
  await page.goto("/welcome");
  await expect(page.getByTestId("waking-banner")).toBeVisible();
  await expect(page.getByTestId("waking-banner")).toHaveCount(0, { timeout: 30_000 });
  expect(n).toBeGreaterThanOrEqual(3);
  expect(warm.length).toBeGreaterThan(0); // /welcome warm-up ping
  await expect(page.locator("body")).not.toContainText(/Unexpected token|is not valid JSON/);
});

test("Connect explains how it works (phone note) and surfaces Developer Mode off", async ({ page }) => {
  const h = await newHolder("cdev");
  const intent = await startConnect(page);
  await expect(page.getByTestId("connect-how")).toContainText("How this works");
  await expect(page.getByTestId("connect-phone-note")).toContainText(/On your phone\?/);
  await expect(page.getByTestId("connect-devmode-hint")).toContainText("Turn on Developer Mode in Binance App → Agentic Wallet → Settings");
  await shot(page, "16-how-this-works");
  const r = await runCompanion("login", intent.code, h, { env: { FAKE_BAW_DEVMODE_OFF: "1" } });
  expect(r.code).not.toBe(0);
  expect(r.out).toMatch(/Developer Mode is off/);
  await expect(page.getByTestId("connect-status")).toContainText("Developer Mode is off. Turn on Developer Mode in Binance App → Agentic Wallet → Settings");
  await page.getByTestId("connect-status").scrollIntoViewIfNeeded();
  await shot(page, "17-developer-mode-off");
});

test("@mobile phone: How this works tells you to run the code where baw is signed in", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, reducedMotion: "reduce", isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await startConnect(page);
  const note = page.getByTestId("connect-phone-note");
  await note.scrollIntoViewIfNeeded();
  await expect(note).toContainText(/computer or AI agent where baw is signed in/);
  await shot(page, "18-mobile-how-this-works");
  await ctx.close();
});
