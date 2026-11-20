import { test, expect, type Page, type Browser } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { createWalletClient, createPublicClient, createTestClient, http, parseAbi, type Hex } from "viem";
import { foundry } from "viem/chains";
import { newHolder, loginViaUi } from "./helpers";

// ATLAS Pay on the local stack: real local AtlasPay contract, real API, real indexer. The test wallet plays the
// part of the user's own wallet (it signs and sends locally); ATLAS only prepares the unsigned transactions.
const OUT = `${process.env.SHOTS_DIR ?? "../../docs/evidence/screenshots"}/pay`;
mkdirSync(OUT, { recursive: true });
const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8545";
type Holder = Awaited<ReturnType<typeof newHolder>>;

async function settle(page: Page, ms = 700) { await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(ms); }
async function sheetShot(page: Page, name: string) { await page.waitForTimeout(600); await page.screenshot({ path: `${OUT}/${name}.png` }); }
/** same-origin API call from a signed-in page (cookie session + CSRF header, like the app) */
async function call(page: Page, path: string, body?: unknown, method = body ? "POST" : "GET") {
  return page.evaluate(async ([p, b, m]) => {
    const csrf = document.cookie.split("; ").find((c) => c.startsWith("atlas_csrf="))?.split("=")[1] ?? "";
    const r = await fetch(`/api${p}`, { method: m as string, headers: { "content-type": "application/json", "x-atlas-csrf": csrf }, body: b ? JSON.stringify(b) : undefined });
    return r.json();
  }, [path, body, method] as const);
}
async function signedIn(browser: Browser, prefix: string, viewport?: { width: number; height: number }) {
  const h = await newHolder(prefix);
  const ctx = await browser.newContext(viewport ? { viewport } : {});
  const page = await ctx.newPage();
  await loginViaUi(page, h);
  const s = await call(page, "/auth/session");
  return { h, page, ctx, userId: s.userId as string };
}
async function sendSteps(h: Holder, steps: any[]) {
  const w = createWalletClient({ account: h.account, chain: foundry, transport: http(RPC) });
  const pc = createPublicClient({ chain: foundry, transport: http(RPC) });
  let last: Hex = "0x";
  for (const s of steps) { last = await w.sendTransaction({ to: s.to, data: s.data, value: BigInt(s.value) }); expect((await pc.waitForTransactionReceipt({ hash: last })).status).toBe("success"); }
  return last;
}

test("send sheet from a profile: amount → full resolved address + gas → Agentic Wallet commands → real tx → indexed receipt", async ({ browser }) => {
  const payee = await signedIn(browser, "payee");
  const payer = await signedIn(browser, "payer");
  const page = payer.page;
  await page.goto(`/u/${payee.h.agentName}`);
  await page.getByTestId("profile-pay").click();
  const sheet = page.getByTestId("send-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId("pay-recipient-name")).toHaveText(payee.h.agentName);
  await sheet.getByTestId("pay-amount").fill("0.02");
  await sheet.getByLabel(/note for/i).fill("thanks for the BNB levels");
  await sheetShot(page, "01-send-amount");
  const [prep] = await Promise.all([page.waitForResponse((r) => r.url().endsWith("/api/pay/prepare")), sheet.getByTestId("pay-review").click()]);
  const prepared = await prep.json();
  await expect(sheet.getByTestId("pay-destination")).toHaveAttribute("data-address", payee.h.account.address);
  await expect(sheet.getByTestId("pay-gas")).toContainText(/BNB|gas/);
  await expect(sheet.getByText("re-checked at execution")).toBeVisible();
  await sheetShot(page, "02-send-review-resolved-address");
  await sheet.getByTestId("pay-authorize").click();
  await expect(sheet.getByTestId("pay-step-0")).toContainText("baw contract-call preview");
  await expect(sheet.getByTestId("pay-step-0")).toContainText(prepared.payContract);
  await sheetShot(page, "03-authorize-agentic-wallet");
  // the user's own wallet signs + sends (here: the local test wallet)
  const tx = await sendSteps(payer.h, prepared.steps);
  await sheet.getByTestId("pay-txhash").fill(tx);
  await sheet.getByTestId("pay-track").click();
  await expect(sheet.getByTestId("pay-receipt-found")).toBeVisible({ timeout: 30_000 });
  await expect(sheet.getByTestId("pay-receipt-found")).toContainText("0.02 BNB");
  // audit F3: the receipt shows its real stage; it is only "paid" once Finalized
  await expect(sheet.getByTestId("pay-stage")).toHaveAttribute("data-stage", /^(confirmed|finalized)$/);
  if ((await sheet.getByTestId("pay-stage").getAttribute("data-stage")) === "confirmed") await expect(sheet.getByTestId("pay-receipt-found")).toHaveAttribute("data-paid", "false");
  await sheetShot(page, "04-receipt-indexed");
  await sheet.getByRole("button", { name: "Done" }).click();
  // receipts history on both sides
  await page.goto("/pay");
  await expect(page.getByTestId("pay-receipt").first()).toContainText(payee.h.agentName);
  await expect(page.getByTestId("pay-receipt").first()).toContainText("−0.02 BNB");
  await settle(page);
  await page.screenshot({ path: `${OUT}/05-receipts-history.png`, fullPage: true });
  await payee.page.goto("/pay");
  await expect(payee.page.getByTestId("pay-receipt").first()).toContainText("+0.02 BNB");
  await expect(payee.page.getByTestId("pay-receipt").first()).toContainText("thanks for the BNB levels");
  await payer.ctx.close(); await payee.ctx.close();
});

test("tip a post with USDT: exact-amount approve + pay, voluntary and outside Skill Score", async ({ browser }) => {
  const author = await signedIn(browser, "author");
  const fan = await signedIn(browser, "fan");
  const post = await call(author.page, "/posts", { body: "BNB/USDT liquidity is thin above the swing high. Watching the retest. #bnb" });
  await fan.page.goto(`/u/${author.h.agentName}`);
  const card = fan.page.locator(`[data-post="${post.id}"]`);
  await card.getByTestId("post-tip").click();
  const sheet = fan.page.getByTestId("send-sheet");
  await expect(sheet).toContainText("Tip on post");
  await expect(sheet).toContainText("never change Skill Score");
  await sheet.getByRole("radio", { name: "USDT" }).click();
  await sheet.getByRole("button", { name: "5", exact: true }).click();
  const [prep] = await Promise.all([fan.page.waitForResponse((r) => r.url().endsWith("/api/pay/prepare")), sheet.getByTestId("pay-review").click()]);
  const p = await prep.json();
  expect(p.kind).toBe("tip");
  expect(p.steps).toHaveLength(2); // approve exactly 5 USDT, then pay
  await expect(sheet.getByText("Approve exact amount, then pay")).toBeVisible();
  await sheetShot(fan.page, "06-tip-usdt-review");
  await sheet.getByTestId("pay-authorize").click();
  await expect(sheet.getByTestId("pay-step-0")).toContainText("approve exactly 5 USDT");
  await sheetShot(fan.page, "07-tip-usdt-two-steps");
  await fan.ctx.close(); await author.ctx.close();
});

test("payment request in a DM: requester sends a card, payer opens it locked to amount + asset", async ({ browser }) => {
  const req = await signedIn(browser, "reqr");
  const payr = await signedIn(browser, "payr");
  await call(req.page, "/follows", { userId: payr.userId });
  await call(payr.page, "/messages", { to: req.userId, body: "Can you send the invoice for the data feed?" });
  await req.page.goto("/messages");
  await req.page.getByTestId("dm-request").click();
  const comp = req.page.getByTestId("request-composer");
  await comp.getByTestId("req-amount").fill("0.03");
  await comp.getByTestId("req-note").fill("Half of this month's data feed");
  await comp.getByTestId("req-create").click();
  await expect(comp.getByTestId("req-created")).toBeVisible();
  await comp.getByRole("button", { name: "Done" }).click();
  await expect(req.page.getByTestId("pay-request-card").last()).toContainText("0.03");
  await req.page.waitForTimeout(600);
  await req.page.screenshot({ path: `${OUT}/08-dm-request-card-requester.png` });
  await payr.page.goto("/messages");
  const cardP = payr.page.getByTestId("pay-request-card").last();
  await expect(cardP).toContainText("Half of this month's data feed");
  await payr.page.waitForTimeout(600);
  await payr.page.screenshot({ path: `${OUT}/09-dm-request-card-payer.png` });
  await cardP.getByTestId("pay-request-pay").click();
  const sheet = payr.page.getByTestId("send-sheet");
  await expect(sheet.getByTestId("pay-amount")).toHaveValue("0.03");
  await expect(sheet.getByTestId("pay-amount")).toHaveAttribute("readonly", "");
  const [prep] = await Promise.all([payr.page.waitForResponse((r) => r.url().endsWith("/api/pay/prepare")), sheet.getByTestId("pay-review").click()]);
  const p = await prep.json();
  expect(p.kind).toBe("request");
  expect(p.steps).toHaveLength(2);
  await sheet.getByTestId("pay-authorize").click();
  await expect(sheet.getByTestId("pay-step-0")).toContainText("approve exactly 0.03 USDT");
  await sheetShot(payr.page, "10-request-authorize");
  // local chain only: fund the payer with the labelled MOCK USDT test token, then the payer pays from their own wallet
  const w = createWalletClient({ account: payr.h.account, chain: foundry, transport: http(RPC) });
  const pc = createPublicClient({ chain: foundry, transport: http(RPC) });
  const mint = await w.writeContract({ address: p.steps[0].to, abi: parseAbi(["function mint(address,uint256)"]), functionName: "mint", args: [payr.h.account.address, 10n ** 18n] });
  await pc.waitForTransactionReceipt({ hash: mint });
  // audit F4: the request is only "pending" while the PaymentSent event is provisional, and Paid once it is final
  await sendSteps(payr.h, p.steps);
  const reqId = (await call(req.page, "/pay/requests")).items[0].id;
  await expect.poll(async () => (await call(payr.page, `/pay/requests/${reqId}`)).status, { timeout: 30_000 }).toMatch(/^(pending|paid)$/);
  await createTestClient({ chain: foundry, mode: "anvil", transport: http(RPC) }).mine({ blocks: 2 });
  await expect.poll(async () => (await call(payr.page, `/pay/requests/${reqId}`)).status, { timeout: 30_000 }).toBe("paid");
  await req.ctx.close(); await payr.ctx.close();
});

test("contracts pending: honest state, no prepare, official baw fallback with mandatory warnings and a separate confirmation", async ({ browser }) => {
  const payee = await signedIn(browser, "pendee");
  const payer = await signedIn(browser, "pender");
  const page = payer.page;
  await page.route("**/api/pay/config", async (route) => {
    const res = await route.fetch(); const json = await res.json();
    await route.fulfill({ response: res, json: { ...json, status: "pending", contract: null, pendingMessage: "AtlasPay is pending deployment on this chain." } });
  });
  let prepared = 0;
  page.on("request", (r) => { if (r.url().endsWith("/api/pay/prepare")) prepared++; });
  await page.goto(`/u/${payee.h.agentName}`);
  await page.getByTestId("profile-pay").click();
  const sheet = page.getByTestId("send-sheet");
  await expect(sheet.getByTestId("pay-pending")).toContainText("Contracts pending deployment");
  await sheet.getByRole("radio", { name: "USDT" }).click();
  await sheet.getByTestId("pay-amount").fill("10");
  await sheet.getByTestId("pay-review").click();
  await expect(sheet.getByTestId("pay-destination")).toHaveAttribute("data-address", payee.h.account.address);
  await expect(sheet.getByTestId("pay-authorize")).toHaveCount(0);
  await sheetShot(page, "11-pending-review");
  await sheet.getByTestId("pay-use-fallback").click();
  await expect(sheet.getByTestId("baw-resolve-cmd")).toContainText(`baw wallet resolve-domain --name ${payee.h.agentName} --binanceChainId 56 --json`);
  await expect(sheet.getByTestId("baw-send-cmd")).toHaveAttribute("data-stale", "false");
  await expect(sheet.getByTestId("baw-send-cmd")).toContainText("<resolved address>");
  // a resolve error blocks
  await sheet.getByTestId("baw-resolve-output").fill(JSON.stringify({ success: false, code: "20003007", message: "no address bound" }));
  await expect(sheet.getByTestId("baw-resolve-error")).toContainText("No address bound");
  // a fallback/contract result shows both mandatory warnings and the mismatch with the Agent ID owner
  const other = "0x1111111111111111111111111111111111111111";
  await sheet.getByTestId("baw-resolve-output").fill(JSON.stringify({ success: true, data: { name: payee.h.agentName, binanceChainId: "56", address: other, isFallback: true, addressType: "CONTRACT" } }));
  await expect(sheet.getByTestId("baw-resolved-address")).toHaveAttribute("data-address", other);
  await expect(sheet.getByText(/no address set for this chain/)).toBeVisible();
  await expect(sheet.getByText(/resolves to a smart contract address/)).toBeVisible();
  await expect(sheet.getByTestId("baw-differs")).toBeVisible();
  await expect(sheet.getByTestId("baw-send-cmd")).not.toContainText(other); // locked until confirmed
  await sheet.getByTestId("baw-confirm").check();
  await expect(sheet.getByTestId("baw-send-cmd")).toContainText(`baw wallet send --amount 10 --recipient ${other} --binanceChainId 56 --tokenAddress 0x55d398326f99059fF775485246999027B3197955 --json`);
  await expect(sheet.getByTestId("baw-broadcast-note")).toContainText("broadcast, not confirmed");
  // matching resolve output
  await sheet.getByTestId("baw-resolve-output").fill(JSON.stringify({ success: true, data: { name: payee.h.agentName, binanceChainId: "56", address: payee.h.account.address, isFallback: false, addressType: "EOA" } }));
  await expect(sheet.getByTestId("baw-confirm")).not.toBeChecked(); // every new resolution needs a new confirmation
  await expect(sheet.getByTestId("baw-matches")).toBeVisible();
  await sheet.getByTestId("baw-confirm").check();
  await sheet.getByTestId("baw-send-cmd").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/12-pending-baw-fallback.png` });
  expect(prepared).toBe(0);
  await payer.ctx.close(); await payee.ctx.close();
});

test("@mobile send sheet is a bottom sheet on phones: amount, resolved address, authorize", async ({ browser }) => {
  const vp = { width: 412, height: 915 };
  const payee = await signedIn(browser, "mpayee", vp);
  const payer = await signedIn(browser, "mpayer", vp);
  const page = payer.page;
  await page.goto(`/u/${payee.h.agentName}`);
  await page.getByTestId("profile-pay").click();
  const sheet = page.getByTestId("send-sheet");
  await sheet.getByTestId("pay-amount").fill("0.05");
  const box = await sheet.boundingBox();
  expect(Math.round(box!.y + box!.height)).toBeGreaterThanOrEqual(vp.height - 2); // anchored to the bottom edge
  await sheetShot(page, "m1-send-amount");
  await sheet.getByTestId("pay-review").click();
  await expect(sheet.getByTestId("pay-destination")).toHaveAttribute("data-address", payee.h.account.address);
  await sheetShot(page, "m2-review");
  await sheet.getByTestId("pay-authorize").click();
  await expect(sheet.getByTestId("pay-step-0")).toBeVisible();
  await sheetShot(page, "m3-authorize");
  await payer.ctx.close(); await payee.ctx.close();
});

test("@mobile pending state + request share page on a phone", async ({ browser }) => {
  const vp = { width: 412, height: 915 };
  const req = await signedIn(browser, "mreq", vp);
  const r = await call(req.page, "/pay/requests", { asset: "USDT", amount: "15", note: "Community BNB liquidity dashboard" });
  const anon = await (await browser.newContext({ viewport: vp })).newPage();
  await anon.goto(`/pay/r/${r.id}`);
  const card = anon.getByTestId("pay-request-card");
  await expect(card).toContainText("15");
  await expect(card).toContainText("Sign in to pay");
  expect(await card.innerText()).not.toMatch(/0x[0-9a-fA-F]{40}/); // never shows an address
  await settle(anon);
  await anon.screenshot({ path: `${OUT}/m4-request-share-page.png` });
  const payer = await signedIn(browser, "mpend", vp);
  await payer.page.route("**/api/pay/config", async (route) => { const res = await route.fetch(); await route.fulfill({ response: res, json: { ...(await res.json()), status: "pending", contract: null } }); });
  await payer.page.goto(`/pay/r/${r.id}`);
  await payer.page.getByTestId("pay-request-pay").click();
  const sheet = payer.page.getByTestId("send-sheet");
  await expect(sheet.getByTestId("pay-pending")).toBeVisible();
  await sheet.getByTestId("pay-review").click();
  await sheet.getByTestId("pay-use-fallback").click();
  await expect(sheet.getByTestId("baw-resolve-cmd")).toBeVisible();
  await sheetShot(payer.page, "m5-pending-fallback");
  await req.ctx.close(); await payer.ctx.close();
});

test("reduced motion: the send sheet still works", async ({ browser }) => {
  const payee = await signedIn(browser, "rmpayee");
  const payer = await signedIn(browser, "rmpayer");
  await payer.page.emulateMedia({ reducedMotion: "reduce" });
  await payer.page.goto(`/u/${payee.h.agentName}`);
  await payer.page.getByTestId("profile-pay").click();
  const sheet = payer.page.getByTestId("send-sheet");
  await sheet.getByTestId("pay-amount").fill("0.01");
  await sheet.getByTestId("pay-review").click();
  await expect(sheet.getByTestId("pay-destination")).toHaveAttribute("data-address", payee.h.account.address);
  await payer.ctx.close(); await payee.ctx.close();
});
