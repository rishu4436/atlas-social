import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { parseBawJson, makeRunner, type BawResult } from "../src/baw.js";
import { checkApiUrl } from "../src/api.js";
import { runLogin, runPay, checkSignRequest, StopError, canAutoSignLogin, DEFAULT_OFFICIAL_ORIGIN, type Ctx } from "../src/flow.js";
import { ATLAS_LOGIN_STATEMENT } from "../src/typed-data-check.js";
import { main } from "../src/cli.js";

const acct = privateKeyToAccount(generatePrivateKey());
const SITE = DEFAULT_OFFICIAL_ORIGIN;
const CODE = "ATC-0123456789ABCDEFGHJKMNPQRS";

const NOW = Math.floor(Date.now() / 1000);
function typed(wallet: string, loginId: string, overrides: any = {}) {
  return JSON.stringify({
    domain: { name: "ATLAS Social", version: "1", chainId: 56 }, primaryType: "AtlasLogin",
    types: {
      EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }, { name: "chainId", type: "uint256" }],
      AtlasLogin: [{ name: "purpose", type: "string" }, { name: "statement", type: "string" }, { name: "audience", type: "string" }, { name: "wallet", type: "address" }, { name: "loginId", type: "string" }, { name: "nonce", type: "bytes32" }, { name: "issuedAt", type: "uint256" }, { name: "expiresAt", type: "uint256" }],
    },
    message: {
      purpose: "ATLAS_LOGIN", statement: "Sign in to ATLAS Social with your Agent ID. This signature only proves wallet ownership. It does not authorize any transaction, transfer or token approval.",
      audience: SITE, wallet, loginId, nonce: `0x${"ab".repeat(32)}`, issuedAt: String(NOW), expiresAt: String(NOW + 300), ...overrides,
    },
  });
}
const signRequest = (wallet: string, loginId: string, o?: any) => JSON.stringify({ method: "eth_signTypedData_v4", params: [wallet, typed(wallet, loginId, o)] });

/** In-process fake: records every baw call so tests can prove what did (not) run. */
function harness(opts: { approve?: string; confirm?: boolean; officialOrigin?: string; site?: string; bawOverrides?: Record<string, BawResult>; payment?: any; purpose?: string; tx?: (body: any) => any; txStatus?: any[] } = {}) {
  const calls: string[][] = [];
  const order: string[] = [];
  const reports: any[] = [];
  const posted: Record<string, any> = {};
  const loginId = "11111111-1111-4111-8111-111111111111";
  const baw = async (args: string[]): Promise<BawResult> => {
    calls.push(args);
    const sub = `${args[0]} ${args[1]}`;
    order.push(`baw ${sub}`);
    if (opts.bawOverrides?.[sub]) return opts.bawOverrides[sub]!;
    switch (sub) {
      case "wallet status": return { ok: true, data: { status: "CONNECTED" } };
      case "wallet address": return { ok: true, data: { addresses: [{ binanceChainId: "56", address: acct.address }] } };
      case "wallet agent-id": return { ok: true, data: { claimed: true, agentId: "alice.ai" } };
      case "wallet settings": return { ok: true, data: { devMode: { enabled: true, expiresAt: Date.now() + 1e6 } } };
      case "sign-message preview": return { ok: true, data: { requestId: "req1", risks: { riskDetails: [{ riskType: "CAUTION", title: "Off-chain signature", description: "test" }] }, requireConfirmation: true } };
      case "sign-message execute": return { ok: true, data: { status: "PENDING_CONFIRMATION", orderId: "msg-order-1" } };
      case "sign-message result": return { ok: true, data: { status: "COMPLETED", signature: "ab".repeat(64), signatureRecovery: "01" } };
      case "contract-call preview": return { ok: true, data: { requestId: "req2", parsedTx: {}, risks: {} } };
      case "contract-call execute": return { ok: true, data: { status: "BROADCASTED", txHash: `0x${"cd".repeat(32)}` } };
      case "wallet resolve-domain": return { ok: true, data: { address: opts.payment?.expectedRecipient, addressType: "EOA", isFallback: false } };
      case "wallet send": return { ok: true, data: { txHash: `0x${"ef".repeat(32)}` } };
      case "auth signin": return { ok: true, data: { qrCodeId: "qr-test-1", expireAt: Date.now() + 600_000, urlForWeb: "https://www.binance.com/en/wallet-auth-official", pairingCode: "BN-PAIR-TEST" } };
      case "auth verify": return { ok: true, data: { status: "SUCCESS" } };
    }
    return { ok: false, code: null, message: "unexpected" };
  };
  const api = async (path: string, body: any) => {
    if (path === "report") { reports.push(body); return { ok: true }; }
    posted[path] = body;
    order.push(`api ${path}`);
    if (path === "open") return { purpose: opts.purpose ?? (opts.payment ? "pay" : "login"), site: opts.site ?? SITE, expiresAt: Math.floor(Date.now() / 1000) + 600, payment: opts.payment };
    if (path === "challenge") return { loginId, chainId: 56, agentName: "alice.ai", signRequest: signRequest(body.wallet, loginId) };
    if (path === "complete") return { ok: true, agentName: "alice.ai" };
    if (path === "tx") return opts.tx ? opts.tx(body) : { ok: true };
    if (path === "tx-status") return opts.txStatus?.shift() ?? { stage: "broadcast", nextStepAllowed: false };
    throw new Error(path);
  };
  const log: string[] = [];
  const asks: string[] = [];
  const ctx: Ctx = {
    api, baw,
    io: { log: (s) => log.push(s), ask: async (q) => { asks.push(q); return opts.approve ?? "yes"; } },
    sleep: async () => {}, pollMs: 1,
    confirm: opts.confirm,
    officialOrigin: opts.officialOrigin,
  };
  return { ctx, calls, reports, posted, log, order, asks };
}

describe("companion: login handoff", () => {
  it("runs status → address → agent-id → settings → preview → (yes) → execute → result → complete", async () => {
    const t = harness();
    await runLogin(t.ctx, CODE);
    expect(t.calls.map((c) => `${c[0]} ${c[1]}`)).toEqual(["wallet status", "wallet address", "wallet agent-id", "wallet settings", "sign-message preview", "sign-message execute", "sign-message result"]);
    expect(t.posted.complete).toMatchObject({ code: CODE, signature: "ab".repeat(64), recovery: "01" });
    expect(t.reports.map((r) => r.stage)).toEqual(["previewing", "awaiting_user_approval", "awaiting_app_confirmation", "signed"]);
    expect(t.log.join("\n")).toMatch(/RISKS reported[\s\S]*Off-chain signature/);
    // the --message argument is passed as ONE argv entry, never through a shell
    const pv = t.calls.find((c) => c[1] === "preview")!;
    expect(JSON.parse(pv[pv.indexOf("--message") + 1]).method).toBe("eth_signTypedData_v4");
  });

  it("y or yes approves; anything else cancels before execute", async () => {
    for (const answer of ["y", "Y", "yes", "YES"]) {
      const t = harness({ approve: answer });
      await runLogin(t.ctx, CODE);
      expect(t.calls.some((c) => c[1] === "execute")).toBe(true);
    }
    for (const answer of ["", "n", "no", "YES please"]) {
      const t = harness({ approve: answer });
      await expect(runLogin(t.ctx, CODE)).rejects.toThrow(/Cancelled/);
      expect(t.calls.some((c) => c[1] === "execute")).toBe(false);
      expect(t.posted.complete).toBeUndefined();
      expect(t.reports.at(-1)).toMatchObject({ stage: "declined" }); // the browser shows "declined, nothing signed"
    }
  });

  const cleanPreview = { ok: true as const, data: { requestId: "req1", parsedMessage: { messageType: "SignTypedData", version: "V4" }, risks: { riskDetails: [], addresses: {}, riskBehaviors: [] } } };

  it("signs a clean official ATLAS login automatically, without asking y/N", async () => {
    const t = harness({ bawOverrides: { "sign-message preview": cleanPreview }, approve: "" });
    await runLogin(t.ctx, CODE);
    expect(t.asks).toEqual([]);
    expect(t.calls.some((c) => c[1] === "execute")).toBe(true);
    expect(t.posted.complete).toBeTruthy();
    expect(t.log.join("\n")).toMatch(/Automatic login: official ATLAS Social v1/);
    expect(t.log.join("\n")).toMatch(/Signed: AtlasLogin[\s\S]*No transaction, transfer or approval/);
    expect(t.reports.map((r) => r.stage)).not.toContain("awaiting_user_approval");
  });

  it("--confirm forces the y/N prompt even when the login would auto-sign", async () => {
    const yes = harness({ bawOverrides: { "sign-message preview": cleanPreview }, confirm: true, approve: "y" });
    await runLogin(yes.ctx, CODE);
    expect(yes.asks.length).toBe(1);
    expect(yes.calls.some((c) => c[1] === "execute")).toBe(true);
    const no = harness({ bawOverrides: { "sign-message preview": cleanPreview }, confirm: true, approve: "n" });
    await expect(runLogin(no.ctx, CODE)).rejects.toThrow(/Cancelled/);
    expect(no.calls.some((c) => c[1] === "execute")).toBe(false);
  });

  it("falls back to y/N when baw reports risks, even on the official origin", async () => {
    const t = harness({ approve: "" }); // default preview includes a CAUTION risk
    await expect(runLogin(t.ctx, CODE)).rejects.toThrow(/Cancelled/);
    expect(t.log.join("\n")).toMatch(/Automatic login skipped \(Binance Agentic Wallet reported risks\)/);
    expect(t.calls.some((c) => c[1] === "execute")).toBe(false);
  });

  it("never auto-signs a payment or contract-call, even with no reported risks", async () => {
    const base = { from: acct.address, recipient: { agentName: "bob.ai", address: "0x00000000000000000000000000000000000000b0" }, network: { chainId: 56, name: "BNB Smart Chain" }, asset: "BNB", amount: "0.01" };
    const t = harness({
      payment: { ...base, mode: "contract-call", steps: [{ title: "Pay 0.01 BNB", to: "0x00000000000000000000000000000000000000aa", data: "0x1234", value: "10000000000000000", chainId: 56 }] },
      approve: "",
    });
    await expect(runPay(t.ctx, CODE)).rejects.toThrow(/Cancelled/);
    expect(t.asks.length).toBe(1);
    expect(t.calls.some((c) => c[0] === "contract-call" && c[1] === "execute")).toBe(false);
  });

  it("canAutoSignLogin requires official origin, chain 56, no risks, and the no-transaction statement", () => {
    const td = JSON.parse(typed(acct.address, "11111111-1111-4111-8111-111111111111"));
    const preview = { parsedMessage: { messageType: "SignTypedData", version: "V4" }, risks: { riskDetails: [] } };
    const base = { officialOrigin: SITE, site: SITE, wallet: acct.address, td, preview };
    expect(canAutoSignLogin(base).ok).toBe(true);
    expect(canAutoSignLogin({ ...base, confirm: true })).toMatchObject({ ok: false, reason: /--confirm/ });
    expect(canAutoSignLogin({ ...base, site: "https://evil.example" }).ok).toBe(false);
    expect(canAutoSignLogin({ ...base, td: { ...td, domain: { ...td.domain, chainId: 1 } } }).ok).toBe(false);
    expect(canAutoSignLogin({ ...base, td: { ...td, message: { ...td.message, statement: "Approve USDT" } } }).ok).toBe(false);
    expect(canAutoSignLogin({ ...base, preview: { ...preview, risks: { riskDetails: [{ title: "x", description: "y" }] } } }).ok).toBe(false);
    expect(ATLAS_LOGIN_STATEMENT).toMatch(/does not authorize any transaction/);
  });

  it("refuses expired, wrong-chain or tampered login messages before any baw preview", async () => {
    for (const o of [{ expiresAt: String(NOW - 10) }, { nonce: "0x00" }, { statement: "Approve USDT" }, { spender: "0x000000000000000000000000000000000000dEaD" }]) {
      const id = "11111111-1111-4111-8111-111111111111";
      expect(() => checkSignRequest(signRequest(acct.address, id, o), acct.address, id, SITE, 56)).toThrow(/Refusing/);
    }
    const id = "11111111-1111-4111-8111-111111111111";
    expect(() => checkSignRequest(signRequest(acct.address, id), acct.address, id, SITE, 1)).toThrow(/chain is 56, expected 1/);
  });

  it("953004 preview failure is reported with the upstream issue and nothing is signed", async () => {
    const t = harness({ bawOverrides: { "sign-message preview": { ok: false, code: "953004", message: "preview failed" } } });
    await expect(runLogin(t.ctx, CODE)).rejects.toThrow(/issues\/400/);
    expect(t.reports.at(-1)).toMatchObject({ stage: "failed", bawCode: "953004" });
    expect(t.calls.some((c) => c[1] === "execute")).toBe(false);
  });

  it("when not signed in, runs official baw auth signin then verify, and prints Binance's own URL/pairing (never an ATLAS QR)", async () => {
    let statusCalls = 0;
    const t = harness();
    const inner = t.ctx.baw;
    t.ctx.baw = async (args, opts) => {
      const sub = `${args[0]} ${args[1]}`;
      if (sub === "wallet status") {
        statusCalls += 1;
        if (statusCalls === 1) return { ok: true, data: { status: "UNCONNECTED" } };
      }
      return inner(args, opts);
    };
    await runLogin(t.ctx, CODE);
    expect(statusCalls).toBe(2);
    expect(t.calls.map((c) => `${c[0]} ${c[1]}`)).toEqual([
      "auth signin", "auth verify", "wallet status",
      "wallet address", "wallet agent-id", "wallet settings",
      "sign-message preview", "sign-message execute", "sign-message result",
    ]);
    expect(t.calls.find((c) => c[0] === "auth" && c[1] === "verify")).toEqual(["auth", "verify", "--qrCodeId", "qr-test-1", "--json"]);
    const out = t.log.join("\n");
    expect(out).toMatch(/https:\/\/www\.binance\.com\/en\/wallet-auth-official/);
    expect(out).toMatch(/BN-PAIR-TEST/);
    expect(out).toMatch(/not an ATLAS QR/i);
    expect(t.posted.complete).toBeTruthy();
  });

  it("stops when official sign-in fails, Agent ID is unclaimed, or Developer Mode is off", async () => {
    await expect(runLogin(harness({ bawOverrides: { "wallet status": { ok: true, data: { status: "UNCONNECTED" } }, "auth signin": { ok: false, code: null, message: "signin exploded" } } }).ctx, CODE)).rejects.toThrow(/baw auth signin failed/);
    await expect(runLogin(harness({ bawOverrides: { "wallet agent-id": { ok: true, data: { claimed: false } } } }).ctx, CODE)).rejects.toThrow(/no Agent ID/);
    await expect(runLogin(harness({ bawOverrides: { "wallet settings": { ok: true, data: { devMode: { enabled: false } } } } }).ctx, CODE)).rejects.toThrow(/Developer Mode is off/);
  });

  it("refuses to sign anything that is not the ATLAS login message for this wallet + loginId + site", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(() => checkSignRequest(signRequest(acct.address, id), acct.address, id, SITE)).not.toThrow();
    const other = privateKeyToAccount(generatePrivateKey()).address;
    expect(() => checkSignRequest(signRequest(other, id), acct.address, id, SITE)).toThrow(StopError);
    expect(() => checkSignRequest(signRequest(acct.address, id), acct.address, "22222222-2222-4222-8222-222222222222", SITE)).toThrow(/not the ATLAS login/);
    expect(() => checkSignRequest(signRequest(acct.address, id, { audience: "https://evil.example" }), acct.address, id, SITE)).toThrow(/not the ATLAS login/);
    const permit = JSON.stringify({ method: "eth_signTypedData_v4", params: [acct.address, JSON.stringify({ domain: { name: "Permit2" }, primaryType: "PermitSingle", types: {}, message: {} })] });
    expect(() => checkSignRequest(permit, acct.address, id, SITE)).toThrow(/not the ATLAS login/);
  });
});

describe("companion: payment handoff", () => {
  const base = { from: acct.address, recipient: { agentName: "bob.ai", address: "0x00000000000000000000000000000000000000b0" }, network: { chainId: 56, name: "BNB Smart Chain" }, asset: "BNB", amount: "0.01" };
  it("contract-call: preview → yes → execute → tx verified, per step", async () => {
    const t = harness({ payment: { ...base, mode: "contract-call", steps: [{ title: "Pay 0.01 BNB", to: "0x00000000000000000000000000000000000000aa", data: "0x1234", value: "10000000000000000", chainId: 56 }] } });
    await runPay(t.ctx, CODE);
    const pv = t.calls.find((c) => c[0] === "contract-call" && c[1] === "preview")!;
    expect(pv).toEqual(["contract-call", "preview", "--binanceChainId", "56", "--from", acct.address, "--to", "0x00000000000000000000000000000000000000aa", "--value", "10000000000000000", "--inputData", "0x1234", "--json"]);
    expect(t.posted.tx).toMatchObject({ step: 0, txHash: `0x${"cd".repeat(32)}` });
  });
  const usdt = { ...base, asset: "USDT", amount: "3", mode: "contract-call", steps: [
    { title: "Approve exactly 3 USDT", to: "0x00000000000000000000000000000000000000ee", data: "0x095ea7b3", value: "0", chainId: 56 },
    { title: "Pay 3 USDT", to: "0x00000000000000000000000000000000000000aa", data: "0x1234", value: "0", chainId: 56 },
  ] };
  const approveTx = (b: any) => (b.step === 0 ? { stepKind: "approve", stage: "broadcast", stageLabel: "Broadcast · not mined yet", paid: false, nextStepAllowed: false } : { stepKind: "pay", stage: "broadcast", stageLabel: "Broadcast · not mined yet", paid: false });
  it("USDT (audit F3): waits for the approval to be mined before previewing the pay step; never says paid", async () => {
    const t = harness({ payment: usdt, tx: approveTx, txStatus: [{ stage: "broadcast", nextStepAllowed: false }, { stage: "approval_mined", stageLabel: "Approval mined · payment step still required", nextStepAllowed: true }] });
    await runPay(t.ctx, CODE);
    const previews = t.order.map((x, i) => [x, i] as const).filter(([x]) => x === "baw contract-call preview").map(([, i]) => i);
    const lastStatus = t.order.lastIndexOf("api tx-status");
    expect(previews).toHaveLength(2);
    expect(lastStatus).toBeGreaterThan(t.order.indexOf("api tx"));
    expect(previews[1]).toBeGreaterThan(lastStatus);
    const out = t.log.join("\n");
    expect(out).toMatch(/not paid yet/i);
    expect(out).toMatch(/NOT paid yet[\s\S]*Finalized/);
    expect(out).not.toMatch(/✔ Submitted/);
  });
  it("USDT: a reverted or replaced approval stops before the pay step", async () => {
    for (const stage of ["reverted", "replaced"]) {
      const t = harness({ payment: usdt, tx: approveTx, txStatus: [{ stage, stageLabel: stage, nextStepAllowed: false }] });
      await expect(runPay(t.ctx, CODE)).rejects.toThrow(/pay step was not sent/);
      expect(t.calls.filter((c) => c[0] === "contract-call" && c[1] === "preview")).toHaveLength(1);
    }
  });
  it("stops if the prepared sender is not this Agentic Wallet, or a step is malformed", async () => {
    const t = harness({ payment: { ...base, from: "0x00000000000000000000000000000000000000c0", mode: "contract-call", steps: [] } });
    await expect(runPay(t.ctx, CODE)).rejects.toThrow(/prepared for/);
    const bad = harness({ payment: { ...base, mode: "contract-call", steps: [{ title: "x", to: "0xnot", data: "0x", value: "0", chainId: 56 }] } });
    await expect(runPay(bad.ctx, CODE)).rejects.toThrow(/Bad step/);
    expect(bad.calls.some((c) => c[0] === "contract-call")).toBe(false);
  });
  it("fallback: resolve-domain must match the ATLAS-read owner before send; mismatch sends nothing", async () => {
    const pay = { ...base, mode: "fallback", expectedRecipient: base.recipient.address, tokenAddress: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", addressBook: "Must be in your address book" };
    const t = harness({ payment: pay });
    await runPay(t.ctx, CODE);
    expect(t.calls.find((c) => c[1] === "send")).toEqual(["wallet", "send", "--amount", "0.01", "--recipient", base.recipient.address, "--binanceChainId", "56", "--tokenAddress", pay.tokenAddress, "--json"]);
    expect(t.log.join("\n")).toMatch(/address book/);
    const m = harness({ payment: pay, bawOverrides: { "wallet resolve-domain": { ok: true, data: { address: "0x00000000000000000000000000000000000000d0", addressType: "EOA" } } } });
    await expect(runPay(m.ctx, CODE)).rejects.toThrow(/differ/);
    expect(m.calls.some((c) => c[1] === "send")).toBe(false);
    expect(m.reports.at(-1)).toMatchObject({ stage: "failed", errorCode: "RESOLVE_MISMATCH" });
  });
});

describe("companion: hardening", () => {
  it("only runs allowlisted baw subcommands", async () => {
    const run = makeRunner("/bin/false");
    expect(await run(["auth", "signin"])).toMatchObject({ ok: false, message: /baw not found|baw returned no JSON|ENOENT/ }); // allowlisted, but /bin/false is not baw
    expect(await run(["wallet", "export-key"])).toMatchObject({ ok: false, message: /refusing/ });
    expect(await run(["sh", "-c"])).toMatchObject({ ok: false, message: /refusing/ });
    expect(await run(["auth", "signout"])).toMatchObject({ ok: false, message: /refusing/ });
  });
  it("source has no server, no shell, no credential handling", () => {
    const src = ["baw.ts", "api.ts", "flow.ts", "cli.ts", "ensure.ts", "errors.ts"].map((f) => fs.readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8")).join("\n");
    expect(src).not.toMatch(/createServer|\.listen\(|node:http"|from "http"|WebSocket/);
    expect(src).not.toMatch(/shell:\s*true|\bexec\(|execSync|spawn\(/);
    expect(src).toMatch(/shell:\s*false/);
    // never reads keys, seed phrases, Binance API secrets or credential files (URL userinfo is only rejected)
    expect(src).not.toMatch(/privateKey|private_key|mnemonic|seed phrase|apiSecret|BINANCE_API|readFile|\.baw\//i);
  });
  it("parses baw JSON success/error and only accepts https (or localhost) APIs", () => {
    expect(parseBawJson('{"success":true,"data":{"status":"CONNECTED"}}', "")).toEqual({ ok: true, data: { status: "CONNECTED" } });
    expect(parseBawJson('{"success":false,"code":953004,"message":"x"}', "")).toMatchObject({ ok: false, code: "953004" });
    expect(parseBawJson("", "Error: 351802 developer mode expired")).toMatchObject({ ok: false, code: "351802" });
    expect(checkApiUrl("https://atlas-social-api.onrender.com/")).toBe("https://atlas-social-api.onrender.com");
    expect(checkApiUrl("http://localhost:3000/api")).toBe("http://localhost:3000/api");
    expect(() => checkApiUrl("http://evil.example")).toThrow();
    expect(() => checkApiUrl("https://user:pw@x.example")).toThrow();
  });
  it("cli validates the code and options before doing anything", async () => {
    const log: string[] = [];
    const io = { log: (s: string) => log.push(s), ask: async () => "no" };
    expect(await main(["login", "not-a-code"], io)).toBe(64);
    expect(await main(["login", CODE, "--api", "http://evil.example"], io)).toBe(64);
    expect(await main(["login", CODE, "--unknown"], io)).toBe(64);
    expect(await main(["--help"], io)).toBe(0);
    expect(await main(["exec", CODE], io)).toBe(64);
  });
});
