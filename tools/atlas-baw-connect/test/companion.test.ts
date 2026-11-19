import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { parseBawJson, makeRunner, type BawResult } from "../src/baw.js";
import { checkApiUrl } from "../src/api.js";
import { runLogin, runPay, checkSignRequest, StopError, type Ctx } from "../src/flow.js";
import { main } from "../src/cli.js";

const acct = privateKeyToAccount(generatePrivateKey());
const SITE = "https://atlas-social-web.vercel.app";
const CODE = "ATC-0123456789ABCDEFGHJKMNPQRS";

function typed(wallet: string, loginId: string, overrides: any = {}) {
  return JSON.stringify({
    domain: { name: "ATLAS Social", version: "1", chainId: 56 }, primaryType: "AtlasLogin",
    types: { AtlasLogin: [] }, message: { purpose: "login", statement: "Sign in to ATLAS Social", audience: SITE, wallet, loginId, nonce: "n", issuedAt: 1, expiresAt: 2, ...overrides },
  });
}
const signRequest = (wallet: string, loginId: string, o?: any) => JSON.stringify({ method: "eth_signTypedData_v4", params: [wallet, typed(wallet, loginId, o)] });

/** In-process fake: records every baw call so tests can prove what did (not) run. */
function harness(opts: { approve?: string; bawOverrides?: Record<string, BawResult>; payment?: any; purpose?: string } = {}) {
  const calls: string[][] = [];
  const reports: any[] = [];
  const posted: Record<string, any> = {};
  const loginId = "11111111-1111-4111-8111-111111111111";
  const baw = async (args: string[]): Promise<BawResult> => {
    calls.push(args);
    const sub = `${args[0]} ${args[1]}`;
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
    }
    return { ok: false, code: null, message: "unexpected" };
  };
  const api = async (path: string, body: any) => {
    if (path === "report") { reports.push(body); return { ok: true }; }
    posted[path] = body;
    if (path === "open") return { purpose: opts.purpose ?? (opts.payment ? "pay" : "login"), site: SITE, expiresAt: Math.floor(Date.now() / 1000) + 600, payment: opts.payment };
    if (path === "challenge") return { loginId, chainId: 56, agentName: "alice.ai", signRequest: signRequest(body.wallet, loginId) };
    if (path === "complete") return { ok: true, agentName: "alice.ai" };
    if (path === "tx") return { ok: true };
    throw new Error(path);
  };
  const log: string[] = [];
  const ctx: Ctx = { api, baw, io: { log: (s) => log.push(s), ask: async () => opts.approve ?? "yes" }, sleep: async () => {}, pollMs: 1 };
  return { ctx, calls, reports, posted, log };
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

  it("anything but an explicit yes cancels before execute", async () => {
    for (const answer of ["", "y", "no", "YES please"]) {
      const t = harness({ approve: answer });
      await expect(runLogin(t.ctx, CODE)).rejects.toThrow(/Cancelled/);
      expect(t.calls.some((c) => c[1] === "execute")).toBe(false);
      expect(t.posted.complete).toBeUndefined();
    }
  });

  it("953004 preview failure is reported with the upstream issue and nothing is signed", async () => {
    const t = harness({ bawOverrides: { "sign-message preview": { ok: false, code: "953004", message: "preview failed" } } });
    await expect(runLogin(t.ctx, CODE)).rejects.toThrow(/issues\/400/);
    expect(t.reports.at(-1)).toMatchObject({ stage: "failed", bawCode: "953004" });
    expect(t.calls.some((c) => c[1] === "execute")).toBe(false);
  });

  it("stops when baw is not signed in, has no Agent ID, or Developer Mode is off (never automates baw pairing)", async () => {
    await expect(runLogin(harness({ bawOverrides: { "wallet status": { ok: true, data: { status: "UNCONNECTED" } } } }).ctx, CODE)).rejects.toThrow(/baw auth signin` yourself/);
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
    expect(await run(["auth", "signin"])).toMatchObject({ ok: false, message: /refusing/ });
    expect(await run(["wallet", "export-key"])).toMatchObject({ ok: false, message: /refusing/ });
    expect(await run(["sh", "-c"])).toMatchObject({ ok: false, message: /refusing/ });
  });
  it("source has no server, no shell, no credential handling", () => {
    const src = ["baw.ts", "api.ts", "flow.ts", "cli.ts"].map((f) => fs.readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8")).join("\n");
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
    expect(await main(["exec", CODE], io)).toBe(64);
  });
});
