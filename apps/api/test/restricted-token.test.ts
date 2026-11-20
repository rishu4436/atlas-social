import { describe, it, expect } from "vitest";
import type { Address } from "viem";
import { restrictedTokenCheck } from "../src/routes/markets.js";
import { PANCAKE_V2_ROUTER, tokenBySymbol, WBNB, USDT } from "@atlas/shared-types";

const NV = tokenBySymbol("NVDAB")!.address;
const ME = "0xc44edDcFfA4227d38bc92a7cA5990953AA7Ff0cF" as Address;
const PAIR = "0x217e9ed14C797dF4597512D2245c00cA93e5a567" as Address;
const COMP = "0x53dBa7AaBDe774787A1F57236B235567dA8e14F4" as Address;

function fakeBsc(opts: { paused?: boolean; blocked?: string[]; pair?: Address }) {
  const checked: string[] = [];
  const bsc = {
    readContract: async ({ functionName, args }: { functionName: string; args: unknown[] }) => {
      if (functionName === "compliance") return COMP;
      if (functionName === "pauseManager") return "0x9fc74Be63f3589485B2423984a7a0557e0CF700a";
      if (functionName === "isTokenPaused") return !!opts.paused;
      if (functionName === "getPair") return opts.pair ?? PAIR;
      if (functionName === "checkIsCompliant") { const a = String(args[1]); checked.push(a); if (opts.blocked?.includes(a)) throw new Error("blocked"); return undefined; }
      throw new Error("unexpected " + functionName);
    },
  };
  return { deps: { bsc } as never, checked };
}

describe("restrictedTokenCheck (issuer-controlled tokens)", () => {
  const path = [NV, WBNB.address, USDT.address];
  it("passes when not paused and wallet, router and the NVDAB pair are compliant", async () => {
    const f = fakeBsc({});
    expect(await restrictedTokenCheck(f.deps, NV, [ME, PANCAKE_V2_ROUTER], path)).toBeNull();
    expect(f.checked).toEqual([ME, PANCAKE_V2_ROUTER, PAIR]); // WBNB->USDT hop does not involve NVDAB
  });
  it("reports pause, blocked accounts, and missing pairs", async () => {
    expect(await restrictedTokenCheck(fakeBsc({ paused: true }).deps, NV, [ME], path)).toMatch(/paused/);
    expect(await restrictedTokenCheck(fakeBsc({ blocked: [PAIR] }).deps, NV, [ME], path)).toMatch(/compliance/);
    expect(await restrictedTokenCheck(fakeBsc({ pair: "0x0000000000000000000000000000000000000000" }).deps, NV, [ME], path)).toMatch(/no PancakeSwap V2 pair/);
  });
});
