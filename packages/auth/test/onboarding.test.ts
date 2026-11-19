import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import {
  AUTH_ERRORS, FALLBACK_CODES, explainAuthError, checkSignatureInput, parseBawOutput, quoteCmd, quotePosix, quotePowerShell,
  bawExecuteCommand, bawResultCommand, isSafeBawId, type AuthErrorCode,
} from "../src/onboarding.js";
import { newChallenge, loginTypedData, typedDataJson, bawSignInCommands } from "../src/index.js";

const acct = privateKeyToAccount(generatePrivateKey());
const c = newChallenge({ wallet: acct.address, audience: "https://atlas.example", chainId: 56, now: 1_800_000_000 });
const ctx = { wallet: acct.address, chainId: 56, loginId: c.loginId, audience: "https://atlas.example" };

/** CommandLineToArgvW / MSVCRT rules (how Node on Windows rebuilds argv from a cmd.exe line). */
function parseMsvcrtArg(s: string): string {
  let out = ""; let i = 0; let inQ = false;
  while (i < s.length) {
    let bs = 0;
    while (s[i] === "\\") { bs++; i++; }
    if (s[i] === '"') {
      out += "\\".repeat(Math.floor(bs / 2));
      if (bs % 2 === 1) out += '"'; else inQ = !inQ;
      i++;
    } else {
      out += "\\".repeat(bs);
      if (i < s.length) out += s[i++];
    }
  }
  expect(inQ).toBe(false);
  return out;
}

describe("error catalog", () => {
  const required: AuthErrorCode[] = [
    "EXPIRED", "SIGNER_MISMATCH", "NOT_AGENT_ID_HOLDER", "SIGNATURE_TRUNCATED", "MALFORMED_SIGNATURE", "CHAIN_MISMATCH",
    "BAW_953004", "ERC1271_REJECTED", "RATE_LIMITED", "CONTRACTS_PENDING", "CHALLENGE_SUPERSEDED", "PASSKEY_UNKNOWN",
  ];
  it("covers every required failure with a title, message and fix", () => {
    for (const k of required) {
      const e = AUTH_ERRORS[k];
      expect(e.title.length).toBeGreaterThan(3);
      expect(e.message.length).toBeGreaterThan(10);
      expect(e.fix.length).toBeGreaterThan(10);
    }
  });
  it("routes unrecoverable signing failures to the on-chain fallback", () => {
    expect(FALLBACK_CODES).toEqual(expect.arrayContaining(["BAW_953004", "ERC1271_REJECTED", "BAW_UNKNOWN_ERROR"]));
    expect(AUTH_ERRORS.EXPIRED.action).toBe("regenerate");
    expect(AUTH_ERRORS.RATE_LIMITED.action).toBe("wait");
    expect(AUTH_ERRORS.BAW_RISK_BLOCKED.action).toBe("stop"); // never offer a bypass
    expect(AUTH_ERRORS.CONTRACTS_PENDING.fallback).toBe(false);
  });
  it("explains unknown codes without inventing success", () => {
    const e = explainAuthError("WHATEVER", "boom");
    expect(e.message).toBe("boom");
    expect(e.fallback).toBe(true);
  });
  it("never tells anyone to share secrets", () => {
    for (const e of Object.values(AUTH_ERRORS)) expect(`${e.message} ${e.fix}`).not.toMatch(/send us|share your (seed|private key)/i);
  });
});

describe("signature input pre-check (avoids burning a challenge on a typo)", async () => {
  const sig = await acct.signTypedData(loginTypedData(c));
  it("accepts full 65-byte and 64-byte+recovery signatures, with or without 0x/quotes", () => {
    expect(checkSignatureInput(sig)).toMatchObject({ ok: true, signature: sig.toLowerCase() });
    expect(checkSignatureInput(`"${sig.slice(2)}"`)).toMatchObject({ ok: true });
    expect(checkSignatureInput(sig.slice(0, 130), "01")).toEqual({ ok: true, signature: sig.slice(0, 130).toLowerCase(), recovery: "01" });
  });
  it("flags missing, truncated, malformed and bad recovery", () => {
    expect(checkSignatureInput("")).toEqual({ ok: false, code: "SIGNATURE_REQUIRED" });
    expect(checkSignatureInput(sig.slice(0, 90))).toEqual({ ok: false, code: "SIGNATURE_TRUNCATED" });
    expect(checkSignatureInput(sig.replace("a", "g"))).toMatchObject({ ok: false });
    expect(checkSignatureInput(sig + "0")).toEqual({ ok: false, code: "MALFORMED_SIGNATURE" });
    expect(checkSignatureInput(sig.slice(0, 130), "05")).toEqual({ ok: false, code: "BAD_RECOVERY" });
    expect(checkSignatureInput(sig.slice(0, 130), "1c")).toMatchObject({ ok: true });
  });
});

describe("pasted baw output", () => {
  const preview = (message: object | string, requestId = "e5f6g7h8") => JSON.stringify({ success: true, data: { requestId, parsedMessage: { messageType: "SignTypedData", version: "V4", message: typeof message === "string" ? message : JSON.stringify(message) }, risks: { riskDetails: [] }, requireConfirmation: true, expiresAt: 1 } });
  it("reads a good preview and checks it is THIS challenge", () => {
    const r = parseBawOutput(preview(JSON.parse(typedDataJson(c))), ctx);
    expect(r).toEqual({ kind: "preview", requestId: "e5f6g7h8", requireConfirmation: true, risks: [], warning: undefined });
  });
  it("flags stale previews, other chains and non-ATLAS messages", () => {
    const old = newChallenge({ wallet: acct.address, audience: "https://atlas.example", chainId: 56 });
    expect(parseBawOutput(preview(JSON.parse(typedDataJson(old))), ctx)).toMatchObject({ warning: "STALE_PREVIEW" });
    const other = JSON.parse(typedDataJson(c)); other.domain.chainId = 1;
    expect(parseBawOutput(preview(other), ctx)).toMatchObject({ warning: "CHAIN_MISMATCH" });
    const permit = JSON.parse(typedDataJson(c)); permit.domain.name = "Permit2"; permit.primaryType = "Permit";
    expect(parseBawOutput(preview(permit), ctx)).toMatchObject({ warning: "WRONG_MESSAGE" });
  });
  it("reads execute/result outputs", () => {
    expect(parseBawOutput(JSON.stringify({ success: true, data: { orderId: "msg-order-1", status: "COMPLETED", signature: "363c", signatureRecovery: "01" } }))).toEqual({ kind: "signature", status: "COMPLETED", orderId: "msg-order-1", signature: "363c", recovery: "01" });
    expect(parseBawOutput(JSON.stringify({ success: true, data: { orderId: "msg-order-1", status: "PENDING_CONFIRMATION", signature: null } }))).toEqual({ kind: "pending", orderId: "msg-order-1" });
    expect(parseBawOutput(JSON.stringify({ success: true, data: { orderId: "o", status: "REJECTED" } }))).toMatchObject({ kind: "error", code: "BAW_SIGN_REJECTED" });
    expect(parseBawOutput(JSON.stringify({ success: true, data: { orderId: "o", status: "BROADCASTED", txHash: "0xabc" } }))).toMatchObject({ kind: "broadcast", txHash: "0xabc" });
  });
  it("maps baw error codes, including the known #400 bug 953004", () => {
    const err = (code: number | string, message = "x") => JSON.stringify({ success: false, error: { code, message } });
    expect(parseBawOutput(err(953004))).toMatchObject({ kind: "error", code: "BAW_953004" });
    expect(parseBawOutput("Error: request failed (953004) unsupported")).toMatchObject({ code: "BAW_953004" });
    expect(parseBawOutput(err(351802))).toMatchObject({ code: "BAW_DEV_MODE_OFF" });
    expect(parseBawOutput(err(351803))).toMatchObject({ code: "BAW_RISK_BLOCKED" });
    expect(parseBawOutput(err(351804))).toMatchObject({ code: "BAW_DEV_MODE_BALANCE_CAP" });
    expect(parseBawOutput(err(351805))).toMatchObject({ code: "BAW_SIMULATION_FAILED" });
    expect(parseBawOutput(err(20003008))).toMatchObject({ code: "BAW_AGENT_ID_SERVICE" });
    expect(parseBawOutput(err(1, "Preview request expired"))).toMatchObject({ code: "BAW_PREVIEW_EXPIRED" });
    expect(parseBawOutput(err(999, "weird"))).toMatchObject({ code: "BAW_UNKNOWN_ERROR" });
  });
  it("reads prerequisite checks", () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    expect(parseBawOutput(JSON.stringify({ success: true, data: { devMode: { enabled: true, expiresAt: future } } }))).toMatchObject({ kind: "settings", devModeOn: true });
    expect(parseBawOutput(JSON.stringify({ success: true, data: { devMode: { enabled: true, expiresAt: 1000 } } }))).toMatchObject({ kind: "settings", devModeOn: false });
    expect(parseBawOutput(JSON.stringify({ success: true, data: { claimed: true, handle: "alice", agentId: "alice.ai" } }))).toEqual({ kind: "agent-id", claimed: true, agentId: "alice.ai" });
    expect(parseBawOutput("Claimed: No\nThis wallet has not claimed")).toMatchObject({ kind: "agent-id", claimed: false });
    expect(parseBawOutput(JSON.stringify({ success: true, data: { status: "UNCONNECTED" } }))).toMatchObject({ code: "BAW_NOT_SIGNED_IN" });
    expect(parseBawOutput("")).toEqual({ kind: "unknown" });
  });
  it("refuses IDs that could inject shell syntax into generated commands", () => {
    expect(parseBawOutput(preview(JSON.parse(typedDataJson(c)), "abc; rm -rf ~"), ctx)).toMatchObject({ kind: "error" });
    expect(isSafeBawId("msg-order-xxx")).toBe(true);
    expect(() => bawExecuteCommand("$(curl evil)")).toThrow();
    expect(() => bawResultCommand("a b")).toThrow();
    expect(bawExecuteCommand("e5f6")).toBe("baw sign-message execute --requestId e5f6 --json");
    expect(bawResultCommand("msg-1")).toBe("baw sign-message result --order-id msg-1 --json");
  });
});

describe("per-shell quoting round-trips the exact message", () => {
  const cmds = bawSignInCommands(c);
  const tricky = `{"a":"it's \\"q\\" \\\\ $HOME \`x\` %PATH% & | > <"}`;
  it("POSIX sh receives the message byte-for-byte", () => {
    for (const m of [cmds.message, tricky]) {
      const out = execFileSync("sh", ["-c", `printf %s ${quotePosix(m)}`]).toString();
      expect(out).toBe(m);
    }
  });
  it("cmd.exe / MSVCRT argv parsing receives the message byte-for-byte", () => {
    for (const m of [cmds.message, tricky, "trailing\\", 'a\\"b']) expect(parseMsvcrtArg(quoteCmd(m))).toBe(m);
  });
  it("PowerShell literal escapes single quotes", () => {
    expect(quotePowerShell("it's")).toBe("'it''s'");
  });
  it("exposes a preview command for each shell, all for chain 56 and EIP712", () => {
    for (const k of ["posix", "powershell", "cmd"] as const) expect(cmds.previewByShell[k]).toMatch(/^baw sign-message preview --binanceChainId 56 --signType EIP712 --message .+ --json$/);
    expect(cmds.preview).toBe(cmds.previewByShell.posix);
    expect(cmds.checkAgentId).toBe("baw wallet agent-id --json");
  });
});
