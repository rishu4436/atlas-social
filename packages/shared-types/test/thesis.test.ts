import { describe, it, expect } from "vitest";
import {
  toPrice8, fromPrice8, canonicalJson, hashCanonical, validateTerms, Direction, EntryKind, Comparator,
  computeThesisCommitment, METHODOLOGY_M1_HASH, type ThesisTerms, thesisDraftSchema,
} from "../src/index.js";

const terms = (): ThesisTerms => ({
  baseAsset: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
  quoteAsset: "0x55d398326f99059fF775485246999027B3197955",
  direction: Direction.Long,
  entry: { kind: EntryKind.AtOrBelow, price: toPrice8("600") },
  target: { comparator: Comparator.GTE, price: toPrice8("660") },
  invalidation: { comparator: Comparator.LTE, price: toPrice8("570") },
  evaluationDeadline: 2000n,
  methodologyHash: METHODOLOGY_M1_HASH,
  contentHash: hashCanonical({ a: 1 }),
});

describe("price scaling", () => {
  it("parses decimals exactly", () => {
    expect(toPrice8("588.99")).toBe(58899000000n);
    expect(toPrice8("0.00000001")).toBe(1n);
    expect(toPrice8("1.123456789")).toBe(112345678n);
    expect(toPrice8(600)).toBe(60000000000n);
    expect(fromPrice8(58899000000n)).toBeCloseTo(588.99);
    expect(() => toPrice8("-1")).toThrow();
    expect(() => toPrice8("1e5")).toThrow();
  });
});

describe("canonical json", () => {
  it("is key-order independent and handles bigint", () => {
    expect(canonicalJson({ b: 1, a: { d: 2n, c: [3] } })).toBe('{"a":{"c":[3],"d":"2"},"b":1}');
    expect(hashCanonical({ x: 1, y: 2 })).toBe(hashCanonical({ y: 2, x: 1 }));
  });
});

describe("term validation mirrors the contract", () => {
  it("accepts valid long", () => expect(validateTerms(terms(), 1000n, 2000n)).toBeNull());
  it("rejects bad cases", () => {
    const t = terms();
    expect(validateTerms({ ...t, entry: { kind: EntryKind.AtOrBelow, price: toPrice8("700") } }, 1000n, 2000n)).toBe("entry");
    expect(validateTerms({ ...t, evaluationDeadline: 1000n }, 1000n, 2000n)).toBe("deadline");
    expect(validateTerms({ ...t, evaluationDeadline: 3000n }, 1000n, 2000n)).toBe("deadline after reveal");
    expect(validateTerms({ ...t, direction: Direction.Short }, 1000n, 2000n)).toBe("short comparators");
    expect(validateTerms({ ...t, quoteAsset: t.baseAsset }, 1000n, 2000n)).toBe("assets");
  });
});

describe("commitment", () => {
  it("binds author, salt and every field", () => {
    const base = { chainId: 56, registry: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0" as const, author: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as const, terms: terms(), salt: hashCanonical("s") };
    const c = computeThesisCommitment(base);
    expect(c).toMatch(/^0x[0-9a-f]{64}$/);
    expect(computeThesisCommitment({ ...base, salt: hashCanonical("t") })).not.toBe(c);
    expect(computeThesisCommitment({ ...base, author: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" })).not.toBe(c);
    expect(computeThesisCommitment({ ...base, chainId: 97 })).not.toBe(c);
    expect(computeThesisCommitment({ ...base, terms: { ...terms(), target: { comparator: Comparator.GTE, price: toPrice8("661") } } })).not.toBe(c);
  });
});

describe("draft schema", () => {
  it("validates input", () => {
    expect(thesisDraftSchema.safeParse({ asset: "BNB", direction: "LONG", targetPrice: "660", invalidationPrice: "570", horizonHours: 72, title: "BNB breakout", summary: "Watching volume near resistance." }).success).toBe(true);
    expect(thesisDraftSchema.safeParse({ asset: "BNB", direction: "UP" }).success).toBe(false);
  });
});
