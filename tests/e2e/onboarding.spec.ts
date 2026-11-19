import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { createWalletClient, createPublicClient, http, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { newHolder } from "./helpers";

// Agent ID onboarding wizard (/onboarding). The tester's wallet is a local anvil account; the JSON pasted into the
// wizard mimics what `baw ... --json` prints (shapes from the Agentic Wallet external-sign docs). Signatures and
// transactions are real (made locally by the test wallet, verified by the real API and the local chain).
const OUT = `${process.env.SHOTS_DIR ?? "../../docs/evidence/screenshots"}/onboarding`;
mkdirSync(OUT, { recursive: true });
const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8545";

type Holder = Awaited<ReturnType<typeof newHolder>>;

async function sign(account: PrivateKeyAccount, ch: any): Promise<Hex> {
  const { EIP712Domain: _d, ...types } = ch.typedData.types;
  return account.signTypedData({ domain: ch.typedData.domain, types, primaryType: "AtlasLogin", message: { ...ch.typedData.message, issuedAt: BigInt(ch.typedData.message.issuedAt), expiresAt: BigInt(ch.typedData.message.expiresAt) } });
}
/** baw returns r|s (64 bytes) and signatureRecovery separately. */
const bawSig = (sig: Hex) => ({ signature: sig.slice(2, 130), signatureRecovery: sig.slice(130) === "1b" ? "00" : "01" });
const previewOut = (ch: any, requestId = `req-${ch.loginId.slice(0, 8)}`, typed = ch.typedData) =>
  JSON.stringify({ success: true, data: { requestId, parsedMessage: { messageType: "SignTypedData", preCheckCode: "", version: "V4", message: JSON.stringify(typed) }, risks: { riskDetails: [], addresses: {}, riskBehaviors: [] }, requireConfirmation: true, expiresAt: Date.now() + 120_000 } }, null, 2);
const errOut = (code: number, message: string) => JSON.stringify({ success: false, error: { code, message } }, null, 2);
const authError = (page: Page, code: string) => page.locator(`[data-testid="auth-error"][data-code="${code}"]`).first();

async function settle(page: Page, ms = 700) { await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(ms); }

async function startChallenge(page: Page, address: string) {
  await page.goto(`/onboarding?wallet=${address}`);
  await page.getByRole("button", { name: /i'm ready/i }).click();
  await expect(page.getByLabel("Agent ID wallet address")).toHaveValue(address);
  const [resp] = await Promise.all([page.waitForResponse((r) => r.url().endsWith("/api/auth/challenge")), page.getByRole("button", { name: /generate my commands/i }).click()]);
  return { status: resp.status(), body: await resp.json() };
}

test("wizard: prerequisites → generated commands → pasted baw output → verify → passkey; passkey sign-in later", async ({ page }) => {
  const h: Holder = await newHolder("onb");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true } });

  await page.goto("/onboarding");
  await expect(page.getByRole("heading", { name: "Verify your Agent ID", level: 1 })).toBeVisible();
  await expect(page.getByText(/never share your seed phrase/i).first()).toBeVisible();
  await settle(page);
  await page.screenshot({ path: `${OUT}/01-prerequisites.png`, fullPage: true });

  // prerequisite checks read pasted output locally
  await page.locator("#pre-out").fill(JSON.stringify({ success: true, data: { claimed: true, handle: h.handle, agentId: h.agentName } }));
  await expect(page.getByTestId("parsed-line")).toContainText(`Agent ID found: ${h.agentName}`);
  await page.locator("#pre-out").fill(JSON.stringify({ success: true, data: { devMode: { enabled: false, expiresAt: 1 } } }));
  await expect(page.getByTestId("parsed-line")).toContainText("Developer Mode is off");
  await page.locator("#pre-out").fill(JSON.stringify({ success: true, data: { address: h.account.address } }));
  await expect(page.getByTestId("parsed-line")).toContainText(h.account.address);
  await page.getByRole("button", { name: /i'm ready/i }).click();
  await expect(page.getByLabel("Agent ID wallet address")).toHaveValue(h.account.address);

  const [resp] = await Promise.all([page.waitForResponse((r) => r.url().endsWith("/api/auth/challenge")), page.getByRole("button", { name: /generate my commands/i }).click()]);
  const ch = await resp.json();
  const preview = page.getByTestId("cmd-preview");
  await expect(preview).toContainText("baw sign-message preview --binanceChainId 31337 --signType EIP712 --message '");
  await expect(preview).toContainText(ch.loginId);
  await expect(page.getByTestId("challenge-timer")).toContainText(/[45]:\d\d/);
  await expect(page.getByTestId("cmd-execute")).toContainText("<requestId from step 1>");

  // per-OS quoting
  await page.getByRole("tab", { name: "Windows Command Prompt" }).click();
  await expect(preview).toContainText('--message "{\\"method\\":\\"eth_signTypedData_v4\\"');
  await expect(page.getByTestId("shell-note")).toContainText("cmd.exe");
  await page.getByRole("tab", { name: "Windows PowerShell 7+" }).click();
  await expect(page.getByTestId("shell-note")).toContainText("PowerShell 7.3");
  await page.getByRole("tab", { name: "macOS / Linux / WSL" }).click();
  await settle(page);
  await page.screenshot({ path: `${OUT}/02-generated-commands.png`, fullPage: true });

  // preview → execute (pending) → result
  await page.locator("#preview-out").fill(previewOut(ch));
  await expect(page.getByTestId("parsed-line").first()).toContainText(`requestId req-${ch.loginId.slice(0, 8)}`);
  await expect(page.getByTestId("cmd-execute")).toContainText(`baw sign-message execute --requestId req-${ch.loginId.slice(0, 8)} --json`);
  await page.locator("#exec-out").fill(JSON.stringify({ success: true, data: { orderId: "msg-order-e2e1", status: "PENDING_CONFIRMATION", signature: null, signatureRecovery: null, message: "Please confirm in the Binance App" } }));
  await expect(page.getByTestId("cmd-result")).toContainText("baw sign-message result --order-id msg-order-e2e1 --json");
  const sig = await sign(h.account, ch);
  await page.locator("#result-out").fill(JSON.stringify({ success: true, data: { orderId: "msg-order-e2e1", status: "COMPLETED", ...bawSig(sig), message: null } }));
  await expect(page.locator("#ob-sig")).toHaveValue(sig.slice(2, 130));
  await expect(page.locator("#ob-rec")).toHaveValue(/^0[01]$/);
  await settle(page);
  await page.screenshot({ path: `${OUT}/03-signature-filled.png`, fullPage: true });

  await page.getByRole("button", { name: /verify signature/i }).click();
  await expect(page.getByText("Agent ID verified")).toBeVisible();
  await expect(page.getByRole("heading", { name: /add a passkey for next time/i })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/social access only/i).first()).toBeVisible();
  await settle(page);
  await page.screenshot({ path: `${OUT}/04-passkey-offer.png`, fullPage: true });
  await page.getByRole("button", { name: /add a passkey/i }).click();
  await expect(page.getByRole("heading", { name: "Passkey added" })).toBeVisible();

  // returning user: passkey only, no CLI
  await page.context().clearCookies();
  await page.goto("/onboarding");
  await page.getByRole("button", { name: /sign in with a passkey/i }).click();
  // the profile was never saved, so even a passkey sign-in goes to profile setup first
  await page.waitForURL("**/welcome/profile", { timeout: 20_000 });
  const s = await page.request.get("/api/auth/session").then((r) => r.json());
  expect(s).toMatchObject({ authenticated: true, method: "passkey" });
});

test("expiry: countdown hits zero → commands marked stale → one-click regenerate invalidates the old challenge", async ({ page }) => {
  const h = await newHolder("exp");
  // Make the FIRST challenge look 4 seconds from expiry to the browser (shifts the server clock reading the countdown
  // uses for skew correction) instead of waiting 5 real minutes. Server-side expiry itself is covered by API tests.
  let first = true;
  await page.route("**/api/auth/challenge", async (route) => {
    const res = await route.fetch();
    const json = await res.json();
    if (first) { first = false; json.serverNow = json.expiresAt - 4; }
    await route.fulfill({ response: res, json });
  });
  const { body: ch } = await startChallenge(page, h.account.address);
  await page.locator("#ob-sig").fill((await sign(h.account, ch)).slice(2));
  await expect(page.getByTestId("cmd-preview")).toHaveAttribute("data-stale", "false");
  await expect(page.getByTestId("challenge-timer")).toContainText(/0:0[0-4]/);
  await expect(page.getByTestId("stale-banner")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("cmd-preview")).toHaveAttribute("data-stale", "true");
  await expect(page.getByTestId("cmd-preview").getByRole("button", { name: /stale, cannot copy/i })).toBeDisabled();
  await expect(page.getByRole("button", { name: /verify signature/i })).toBeDisabled();
  await expect(page.getByTestId("challenge-timer")).toContainText("Expired");
  await settle(page);
  await page.screenshot({ path: `${OUT}/05-expired-stale.png`, fullPage: true });

  const [req, resp] = await Promise.all([
    page.waitForRequest((r) => r.url().endsWith("/api/auth/challenge") && r.method() === "POST"),
    page.waitForResponse((r) => r.url().endsWith("/api/auth/challenge")),
    page.getByRole("button", { name: /generate new challenge/i }).click(),
  ]);
  expect(JSON.parse(req.postData()!).replaces).toBe(ch.loginId);
  const fresh = await resp.json();
  await expect(page.getByTestId("cmd-preview")).toHaveAttribute("data-stale", "false");
  await expect(page.getByTestId("cmd-preview")).toContainText(fresh.loginId);
  await expect(page.getByTestId("stale-banner")).toHaveCount(0);
  await expect(page.getByTestId("challenge-timer")).toContainText(/[45]:\d\d/);
  await expect(page.locator("#ob-sig")).toHaveValue("");
  expect((await page.request.get(`/api/auth/challenge/${ch.loginId}`).then((r) => r.json())).state).toBe("superseded");
  // the old signature is refused by the server even if someone submits it directly
  const stale = await page.request.post("/api/auth/verify", { data: { loginId: ch.loginId, signature: await sign(h.account, ch) } });
  expect((await stale.json()).error).toBe("CHALLENGE_SUPERSEDED");

  await page.locator("#ob-sig").fill(await sign(h.account, fresh));
  await page.getByRole("button", { name: /verify signature/i }).click();
  await expect(page.getByText("Agent ID verified")).toBeVisible();
});

test("auto-renew: an expired challenge is replaced automatically when the toggle is on", async ({ page }) => {
  const h = await newHolder("auto");
  let n = 0;
  await page.route("**/api/auth/challenge", async (route) => {
    const res = await route.fetch();
    const json = await res.json();
    if (n++ === 0) json.serverNow = json.expiresAt - 3;
    await route.fulfill({ response: res, json });
  });
  const { body: ch } = await startChallenge(page, h.account.address);
  await page.getByLabel(/auto-renew the challenge/i).check();
  const req = await page.waitForRequest((r) => r.url().endsWith("/api/auth/challenge") && r.method() === "POST", { timeout: 15_000 });
  expect(JSON.parse(req.postData()!).replaces).toBe(ch.loginId);
  await expect(page.getByTestId("cmd-preview")).toHaveAttribute("data-stale", "false");
  await expect(page.getByTestId("cmd-preview")).not.toContainText(ch.loginId);
});

test("error states map to clear messages and fixes", async ({ page }) => {
  // no Agent ID
  const nobody = privateKeyToAccount(generatePrivateKey());
  const r0 = await startChallenge(page, nobody.address);
  expect(r0.status).toBe(403);
  await expect(authError(page, "NOT_AGENT_ID_HOLDER")).toContainText(/claim one in the binance app/i);
  await settle(page);
  await page.screenshot({ path: `${OUT}/06-error-no-agent-id.png` });

  const h = await newHolder("err");
  const { body: ch } = await startChallenge(page, h.account.address);
  const verifyCalls: string[] = [];
  page.on("request", (r) => { if (r.url().endsWith("/api/auth/verify")) verifyCalls.push(r.url()); });

  // truncated signature: caught locally, the challenge is not burned
  const good = await sign(h.account, ch);
  await page.locator("#ob-sig").fill(good.slice(0, 90));
  await expect(page.getByTestId("sig-hint")).toContainText("Signature looks cut off");
  await page.getByRole("button", { name: /verify signature/i }).click();
  await expect(authError(page, "SIGNATURE_TRUNCATED")).toBeVisible();
  expect(verifyCalls).toHaveLength(0);

  // stale preview / chain mismatch / non-ATLAS message in pasted preview output
  const otherChain = { ...ch.typedData, domain: { ...ch.typedData.domain, chainId: 1 } };
  await page.locator("#preview-out").fill(previewOut(ch, "req-chain", otherChain));
  await expect(authError(page, "CHAIN_MISMATCH")).toBeVisible();
  const permit = { ...ch.typedData, domain: { ...ch.typedData.domain, name: "Permit2" }, primaryType: "Permit" };
  await page.locator("#preview-out").fill(previewOut(ch, "req-permit", permit));
  await expect(authError(page, "WRONG_MESSAGE")).toContainText(/do not execute/i);
  const oldMsg = { ...ch.typedData, message: { ...ch.typedData.message, loginId: "00000000-0000-4000-8000-000000000000" } };
  await page.locator("#preview-out").fill(previewOut(ch, "req-old", oldMsg));
  await expect(authError(page, "STALE_PREVIEW")).toBeVisible();
  await page.locator("#preview-out").fill(errOut(351802, "Developer mode expired"));
  await expect(authError(page, "BAW_DEV_MODE_OFF")).toContainText(/Developer Mode/);
  await page.locator("#preview-out").fill("");

  // rate limit (server answer stubbed so the real limiter isn't exhausted for other tests)
  await page.route("**/api/auth/verify", (route) => route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ error: "RATE_LIMITED", message: "Too many requests. Wait a minute and try again.", details: { retryAfterSeconds: 42, action: "wait", fallback: false } }) }));
  await page.locator("#ob-sig").fill(good);
  await page.getByRole("button", { name: /verify signature/i }).click();
  await expect(authError(page, "RATE_LIMITED")).toContainText("about 42s");
  // ERC-1271 smart-wallet refusal → routed to the on-chain proof (stubbed answer; the real path is covered by API tests)
  await page.unroute("**/api/auth/verify");
  await page.route("**/api/auth/verify", (route) => route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "ERC1271_REJECTED", message: "x", details: { action: "fallback", fallback: true } }) }));
  await page.getByRole("button", { name: /verify signature/i }).click();
  await expect(authError(page, "ERC1271_REJECTED").getByRole("button", { name: /use the on-chain proof/i })).toBeVisible();
  await page.unroute("**/api/auth/verify");
  await page.getByRole("button", { name: "Dismiss" }).first().click();

  // wrong signer (real API): SIGNER_MISMATCH with the recovered address; burned challenge is replaced automatically
  const intruder = privateKeyToAccount(generatePrivateKey());
  await page.locator("#ob-sig").fill(await sign(intruder, ch));
  const regen = page.waitForRequest((r) => r.url().endsWith("/api/auth/challenge") && r.method() === "POST");
  await page.getByRole("button", { name: /verify signature/i }).click();
  await expect(authError(page, "SIGNER_MISMATCH")).toContainText(intruder.address);
  expect(JSON.parse((await regen).postData()!).replaces).toBe(ch.loginId);
  await expect(page.getByTestId("cmd-preview")).not.toContainText(ch.loginId);
  await settle(page);
  await page.screenshot({ path: `${OUT}/07-error-signer-mismatch.png`, fullPage: true });

  // known Agentic Wallet bug #400 / 953004 → guided on-chain fallback
  await page.locator("#preview-out").fill(errOut(953004, "sign-message preview failed"));
  const bug = authError(page, "BAW_953004");
  await expect(bug).toContainText("#400");
  await settle(page);
  await page.screenshot({ path: `${OUT}/08-error-953004.png`, fullPage: true });
  await bug.getByRole("button", { name: /use the on-chain proof/i }).click();
  await expect(page.getByTestId("onchain-path")).toBeVisible();
});

test("on-chain fallback (local chain): PROOF_PENDING until the registerIdentity tx lands, then verified", async ({ page }) => {
  const h = await newHolder("chain");
  const { body: ch } = await startChallenge(page, h.account.address);
  await page.locator("#preview-out").fill(errOut(953004, "sign-message preview failed"));
  await authError(page, "BAW_953004").getByRole("button", { name: /use the on-chain proof/i }).click();
  const fb = ch.onchainFallback;
  await expect(page.getByTestId("oc-preview")).toContainText(`baw contract-call preview --binanceChainId 31337 --from ${h.account.address} --to ${fb.transaction.to} --value 0 --inputData ${fb.transaction.data}`);
  await page.getByRole("button", { name: /i've sent it — verify on-chain/i }).click();
  await expect(authError(page, "PROOF_PENDING")).toBeVisible();

  // the tester's own wallet sends registerIdentity(commitment) (real tx on local anvil)
  const w = createWalletClient({ account: h.account, chain: foundry, transport: http(RPC) });
  const hash = await w.sendTransaction({ to: fb.transaction.to, data: fb.transaction.data, value: 0n });
  await createPublicClient({ chain: foundry, transport: http(RPC) }).waitForTransactionReceipt({ hash });
  await page.locator("#oc-preview-out").fill(JSON.stringify({ success: true, data: { requestId: "cc-req-1", parsedTx: { transactionType: "ContractCall", contractAddress: fb.transaction.to }, simulationResult: { authorityChanges: [], allowanceChanges: [] }, risks: { riskDetails: [] }, requireConfirmation: false } }));
  await expect(page.getByTestId("oc-execute")).toContainText("baw contract-call execute --requestId cc-req-1 --json");
  await page.locator("#oc-exec-out").fill(JSON.stringify({ success: true, data: { orderId: "order-1", status: "BROADCASTED", txHash: hash, message: null } }));
  await settle(page);
  await page.screenshot({ path: `${OUT}/09-onchain-fallback.png`, fullPage: true });
  await authError(page, "PROOF_PENDING").getByRole("button", { name: /try again/i }).click();
  await expect(page.getByText("Agent ID verified")).toBeVisible();
});

test("on-chain fallback while contracts are pending: honest state, no verify button", async ({ page }) => {
  const h = await newHolder("pend");
  await page.route("**/api/auth/challenge", async (route) => {
    const res = await route.fetch();
    const json = await res.json();
    await route.fulfill({ response: res, json: { ...json, contractsPending: true, onchainFallback: null } });
  });
  await startChallenge(page, h.account.address);
  await page.getByRole("button", { name: /use the on-chain proof/i }).first().click();
  const pending = page.getByTestId("onchain-pending");
  await expect(pending).toContainText("Contracts pending deployment");
  await expect(page.getByRole("button", { name: /verify on-chain/i })).toHaveCount(0);
  await settle(page);
  await page.screenshot({ path: `${OUT}/10-contracts-pending.png`, fullPage: true });
  await page.getByRole("button", { name: /back to the signature path/i }).click();
  await expect(page.getByTestId("cmd-preview")).toBeVisible();
});

test("reduced motion: the wizard works with prefers-reduced-motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const h = await newHolder("rm");
  const { body: ch } = await startChallenge(page, h.account.address);
  await expect(page.getByTestId("cmd-preview")).toContainText(ch.loginId);
  await page.locator("#ob-sig").fill(await sign(h.account, ch));
  await page.getByRole("button", { name: /verify signature/i }).click();
  await expect(page.getByRole("heading", { name: /add a passkey for next time/i })).toBeVisible({ timeout: 10_000 });
});

test("judge guide lists every error with a fix", async ({ page }) => {
  await page.goto("/onboarding/guide");
  await expect(page.getByRole("heading", { name: /how to verify agent id sign-in/i })).toBeVisible();
  const table = page.getByTestId("error-table");
  for (const code of ["EXPIRED", "SIGNER_MISMATCH", "NOT_AGENT_ID_HOLDER", "SIGNATURE_TRUNCATED", "CHAIN_MISMATCH", "BAW_953004", "ERC1271_REJECTED", "RATE_LIMITED"]) await expect(table.getByText(code, { exact: true })).toBeVisible();
  await settle(page);
  await page.screenshot({ path: `${OUT}/11-judge-guide.png`, fullPage: true });
});

test("@mobile wizard on a phone: prerequisites, commands, verify", async ({ page }) => {
  const h = await newHolder("mob");
  await page.goto("/onboarding");
  await expect(page.getByRole("heading", { name: "Verify your Agent ID", level: 1 })).toBeVisible();
  await settle(page);
  await page.screenshot({ path: `${OUT}/m1-prerequisites.png`, fullPage: true });
  const { body: ch } = await startChallenge(page, h.account.address);
  await expect(page.getByTestId("cmd-preview")).toContainText(ch.loginId);
  await expect(page.getByTestId("challenge-timer")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true); // no sideways scroll
  await settle(page);
  await page.screenshot({ path: `${OUT}/m2-commands.png`, fullPage: true });
  await page.locator("#exec-out").fill(JSON.stringify({ success: true, data: { orderId: "m-1", status: "COMPLETED", ...bawSig(await sign(h.account, ch)) } }));
  await page.getByRole("button", { name: /verify signature/i }).click();
  await expect(page.getByRole("heading", { name: /add a passkey for next time/i })).toBeVisible({ timeout: 10_000 });
  await settle(page);
  await page.screenshot({ path: `${OUT}/m3-passkey-offer.png`, fullPage: true });
  await page.getByRole("button", { name: /skip for now/i }).click();
  await page.waitForURL("**/welcome/profile"); // new account: profile setup next
});
