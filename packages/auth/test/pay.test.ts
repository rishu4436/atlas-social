import { describe, it, expect } from "vitest";
import { bawResolveCommand, bawSendCommand, parseBawResolve, BAW_FALLBACK_WARNING, BAW_CONTRACT_WARNING, BAW_NATIVE_TOKEN, BSC_USDT, isPayAmount } from "../src/pay.js";

const A = "0x1234567890abcdef1234567890abcdef12345678";
describe("baw pay fallback (official send + resolve-domain flow)", () => {
  it("builds the documented resolve and send commands", () => {
    expect(bawResolveCommand("alice.ai")).toBe("baw wallet resolve-domain --name alice.ai --binanceChainId 56 --json");
    expect(bawSendCommand({ recipient: A, asset: "BNB", amount: "0.02" })).toBe(`baw wallet send --amount 0.02 --recipient ${A} --binanceChainId 56 --tokenAddress ${BAW_NATIVE_TOKEN} --json`);
    expect(bawSendCommand({ recipient: A, asset: "USDT", amount: "10", gasLevel: "LOW" })).toBe(`baw wallet send --amount 10 --recipient ${A} --binanceChainId 56 --tokenAddress ${BSC_USDT} --gasLevel LOW --json`);
  });
  it("never accepts a domain or junk as --recipient / name", () => {
    expect(() => bawSendCommand({ recipient: "alice.ai", asset: "BNB", amount: "1" })).toThrow(/never a domain/);
    expect(() => bawResolveCommand("alice.ai; rm -rf ~")).toThrow();
    expect(() => bawSendCommand({ recipient: A, asset: "BNB", amount: "1e18" })).toThrow();
    expect(isPayAmount("0")).toBe(false);
    expect(isPayAmount("0.000000000000000001")).toBe(true);
  });
  it("parses resolve output and attaches mandatory warnings", () => {
    const ok = parseBawResolve(JSON.stringify({ success: true, data: { name: "alice.ai", binanceChainId: "56", address: A, isFallback: false, addressType: "EOA" } }), "alice.ai");
    expect(ok).toMatchObject({ ok: true, address: A, warnings: [] });
    const fb = parseBawResolve(`some log\n${JSON.stringify({ success: true, data: { name: "alice.ai", binanceChainId: "56", address: A, isFallback: true, addressType: "CONTRACT" } })}`);
    expect(fb.warnings).toEqual([BAW_FALLBACK_WARNING, BAW_CONTRACT_WARNING]);
    const unk = parseBawResolve(JSON.stringify({ success: true, data: { name: "alice.ai", binanceChainId: "56", address: A, addressType: "UNKNOWN" } }));
    expect(unk.warnings[0]).toMatch(/could not verify whether/);
  });
  it("blocks on errors, other names and other chains", () => {
    expect(parseBawResolve(JSON.stringify({ success: false, code: "20003007", message: "no address" }))).toMatchObject({ ok: false, errorCode: "20003007" });
    expect(parseBawResolve("Error 20003005 unsupported").errorCode).toBe("20003005");
    expect(parseBawResolve(JSON.stringify({ success: true, data: { name: "bob.ai", binanceChainId: "56", address: A } }), "alice.ai").ok).toBe(false);
    expect(parseBawResolve(JSON.stringify({ success: true, data: { name: "alice.ai", binanceChainId: "1", address: A } })).ok).toBe(false);
    expect(parseBawResolve("hello").ok).toBe(false);
  });
});
