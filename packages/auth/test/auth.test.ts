import { describe, it, expect } from "vitest";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { hexToSignature } from "viem";
import {
  newChallenge, loginTypedData, verifyLoginSignature, normalizeSignature, bawSignInCommands, identityCommitment,
  typedDataJson, authLevel, hashToken, safeEqual, bawContractCallCommand,
} from "../src/index.js";

const AUD = "https://atlas.local";
const acct = privateKeyToAccount(generatePrivateKey());
const other = privateKeyToAccount(generatePrivateKey());

async function signed(now = 1_800_000_000) {
  const c = newChallenge({ wallet: acct.address, audience: AUD, chainId: 56, now });
  const sig = await acct.signTypedData(loginTypedData(c));
  return { c, sig, now };
}

describe("EIP-712 login challenge", () => {
  it("verifies a valid EOA signature", async () => {
    const { c, sig, now } = await signed();
    const r = await verifyLoginSignature({ challenge: c, signature: sig, expected: { audience: AUD, chainId: 56 }, now: now + 10 });
    expect(r).toEqual({ ok: true, wallet: acct.address, method: "ecrecover" });
  });

  it("accepts the Agentic Wallet r||s + signatureRecovery format", async () => {
    const { c, sig, now } = await signed();
    const { yParity } = hexToSignature(sig);
    const rs = sig.slice(2, 130);
    const r = await verifyLoginSignature({ challenge: c, signature: rs, recovery: `0${yParity}`, expected: { audience: AUD, chainId: 56 }, now });
    expect(r.ok).toBe(true);
    const r2 = await verifyLoginSignature({ challenge: c, signature: rs, expected: { audience: AUD, chainId: 56 }, now });
    expect(r2.ok).toBe(true); // tries both parities
  });

  // Security table: "Someone submits a copied wallet signature -> rejected if nonce used, expired or context-mismatched"
  it("rejects used, expired, wrong-audience, wrong-chain and wrong-signer cases", async () => {
    const { c, sig, now } = await signed();
    const exp = { audience: AUD, chainId: 56 };
    expect(await verifyLoginSignature({ challenge: { ...c, usedAt: now }, signature: sig, expected: exp, now })).toEqual({ ok: false, reason: "ALREADY_USED" });
    expect(await verifyLoginSignature({ challenge: c, signature: sig, expected: exp, now: c.expiresAt + 1 })).toEqual({ ok: false, reason: "EXPIRED" });
    expect(await verifyLoginSignature({ challenge: c, signature: sig, expected: { ...exp, audience: "https://evil.example" }, now })).toEqual({ ok: false, reason: "AUDIENCE_MISMATCH" });
    expect(await verifyLoginSignature({ challenge: c, signature: sig, expected: { ...exp, chainId: 97 }, now })).toEqual({ ok: false, reason: "CHAIN_MISMATCH" });
    // signature replayed against a NEW challenge (different nonce) fails
    const c2 = newChallenge({ wallet: acct.address, audience: AUD, chainId: 56, now });
    expect((await verifyLoginSignature({ challenge: c2, signature: sig, expected: exp, now })).ok).toBe(false);
    // signed by someone else for the victim's challenge
    const forged = await other.signTypedData(loginTypedData(c));
    expect(await verifyLoginSignature({ challenge: c, signature: forged, expected: exp, now })).toEqual({ ok: false, reason: "SIGNER_MISMATCH", recovered: other.address });
    expect(await verifyLoginSignature({ challenge: c, signature: "0x1234", expected: exp, now })).toEqual({ ok: false, reason: "SIGNATURE_TRUNCATED" });
    expect(await verifyLoginSignature({ challenge: c, signature: sig.slice(0, 100), expected: exp, now })).toEqual({ ok: false, reason: "SIGNATURE_TRUNCATED" });
    expect(await verifyLoginSignature({ challenge: c, signature: "0x" + "zz".repeat(65), expected: exp, now })).toEqual({ ok: false, reason: "MALFORMED_SIGNATURE" });
    expect(await verifyLoginSignature({ challenge: c, signature: sig + "a", expected: exp, now })).toEqual({ ok: false, reason: "MALFORMED_SIGNATURE" });
  });

  it("uses ERC-1271 via the public client when ecrecover does not match", async () => {
    const { c, now } = await signed();
    const client = { verifyTypedData: async () => true };
    const sig = "0x" + "ab".repeat(100);
    const r = await verifyLoginSignature({ challenge: c, signature: sig, expected: { audience: AUD, chainId: 56 }, client: client as never, now });
    expect(r).toEqual({ ok: true, wallet: acct.address, method: "erc1271" });
    const deny = { verifyTypedData: async () => false };
    expect((await verifyLoginSignature({ challenge: c, signature: sig, expected: { audience: AUD, chainId: 56 }, client: deny as never, now })).ok).toBe(false);
    // a smart-contract wallet that refuses the signature gets ERC1271_REJECTED (routes the user to the on-chain proof)
    const contractWallet = { verifyTypedData: async () => false, getCode: async () => "0x6080604052" };
    expect(await verifyLoginSignature({ challenge: c, signature: sig, expected: { audience: AUD, chainId: 56 }, client: contractWallet as never, now })).toEqual({ ok: false, reason: "ERC1271_REJECTED" });
    // an EOA (no code) gets SIGNER_MISMATCH instead
    const eoa = { verifyTypedData: async () => false, getCode: async () => undefined };
    expect((await verifyLoginSignature({ challenge: c, signature: sig, expected: { audience: AUD, chainId: 56 }, client: eoa as never, now }) as any).reason).toBe("SIGNER_MISMATCH");
  });

  it("normalizes signature formats", () => {
    expect(normalizeSignature("0x" + "a".repeat(130))).toHaveLength(1);
    expect(normalizeSignature("b".repeat(128), "1c")[0]!.endsWith("1c")).toBe(true);
    expect(normalizeSignature("b".repeat(128), 0)[0]!.endsWith("1b")).toBe(true);
    expect(() => normalizeSignature("zz")).toThrow();
    expect(() => normalizeSignature("b".repeat(128), "05")).toThrow();
  });

  it("builds the documented baw external-sign commands and typed data JSON", () => {
    const c = newChallenge({ wallet: acct.address, audience: AUD, chainId: 56 });
    const cmd = bawSignInCommands(c);
    expect(cmd.preview).toContain("baw sign-message preview --binanceChainId 56 --signType EIP712 --message");
    expect(JSON.parse(cmd.message).method).toBe("eth_signTypedData_v4");
    const td = JSON.parse(typedDataJson(c));
    expect(td.types.EIP712Domain).toBeDefined();
    expect(td.message.nonce).toBe(c.nonce);
    expect(bawContractCallCommand({ chainId: 56, from: acct.address, to: acct.address, data: "0x1234" }).preview).toContain("--inputData 0x1234");
  });

  it("identity commitment binds wallet and nonce", () => {
    const c = newChallenge({ wallet: acct.address, audience: AUD, chainId: 56 });
    const reg = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512" as const;
    expect(identityCommitment(c, reg)).not.toBe(identityCommitment({ ...c, wallet: other.address }, reg));
    expect(identityCommitment(c, reg)).not.toBe(identityCommitment({ ...c, nonce: ("0x" + "00".repeat(32)) as `0x${string}` }, reg));
  });
});

describe("sessions", () => {
  it("derives auth levels", () => {
    const now = 1_000_000;
    const base = { userId: "u", createdAt: now - 100, lastSeenAt: now - 10, expiresAt: now + 1000, walletVerifiedAt: null, method: "passkey" as const };
    expect(authLevel(null, now)).toBe("guest");
    expect(authLevel(base, now)).toBe("session");
    expect(authLevel({ ...base, walletVerifiedAt: now - 60 }, now)).toBe("fresh-wallet");
    expect(authLevel({ ...base, expiresAt: now - 1 }, now)).toBe("guest");
    expect(hashToken("a")).toHaveLength(64);
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
  });
});
