import { encodeAbiParameters, keccak256, toBytes, toHex, type Address, type Hex } from "viem";
import { z } from "zod";

/** Mirrors AtlasThesisRegistry enums. */
export enum Direction { None = 0, Long = 1, Short = 2 }
export enum EntryKind { Market = 0, AtOrBelow = 1, AtOrAbove = 2 }
export enum Comparator { None = 0, GTE = 1, LTE = 2 }
export enum ThesisStatus { None = 0, Committed = 1, Published = 2, Cancelled = 3 }
export enum OutcomeKind { None = 0, TargetHit = 1, InvalidationHit = 2, Expired = 3, Unresolved = 4, Void = 5, Forfeited = 6 }
export enum OutcomeState { None = 0, Proposed = 1, Challenged = 2, Final = 3 }
export enum ReviewStance { None = 0, Endorse = 1, Dispute = 2, Neutral = 3 }
export enum EvidenceKind { None = 0, ThesisContent = 1, TradeProof = 2, OutcomeEvidence = 3, MarketData = 4 }

export const PRICE_DECIMALS = 8;
export const PRICE_SCALE = 10n ** 8n;

export interface ThesisTerms {
  baseAsset: Address;
  quoteAsset: Address;
  direction: Direction;
  entry: { kind: EntryKind; price: bigint };
  target: { comparator: Comparator; price: bigint };
  invalidation: { comparator: Comparator; price: bigint };
  evaluationDeadline: bigint;
  methodologyHash: Hex;
  contentHash: Hex;
}

export const THESIS_TERMS_ABI_PARAM = {
  type: "tuple",
  components: [
    { name: "baseAsset", type: "address" },
    { name: "quoteAsset", type: "address" },
    { name: "direction", type: "uint8" },
    { name: "entry", type: "tuple", components: [{ name: "kind", type: "uint8" }, { name: "price", type: "uint128" }] },
    { name: "target", type: "tuple", components: [{ name: "comparator", type: "uint8" }, { name: "price", type: "uint128" }] },
    { name: "invalidation", type: "tuple", components: [{ name: "comparator", type: "uint8" }, { name: "price", type: "uint128" }] },
    { name: "evaluationDeadline", type: "uint64" },
    { name: "methodologyHash", type: "bytes32" },
    { name: "contentHash", type: "bytes32" },
  ],
} as const;

export const COMMITMENT_TYPEHASH = keccak256(toBytes("ATLAS_THESIS_V1"));

/** Must equal AtlasThesisRegistry.computeCommitment (tested against the contract). */
export function computeThesisCommitment(args: {
  chainId: number;
  registry: Address;
  author: Address;
  terms: ThesisTerms;
  salt: Hex;
}): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "uint256" },
        { type: "address" },
        { type: "address" },
        THESIS_TERMS_ABI_PARAM,
        { type: "bytes32" },
      ],
      [COMMITMENT_TYPEHASH, BigInt(args.chainId), args.registry, args.author, termsToAbi(args.terms), args.salt],
    ),
  );
}

export function termsToAbi(t: ThesisTerms) {
  return {
    baseAsset: t.baseAsset,
    quoteAsset: t.quoteAsset,
    direction: t.direction,
    entry: { kind: t.entry.kind, price: t.entry.price },
    target: { comparator: t.target.comparator, price: t.target.price },
    invalidation: { comparator: t.invalidation.comparator, price: t.invalidation.price },
    evaluationDeadline: t.evaluationDeadline,
    methodologyHash: t.methodologyHash,
    contentHash: t.contentHash,
  };
}

export function randomSalt(): Hex {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return toHex(b);
}

/** Decimal string/number -> 8-decimal fixed point bigint, without float rounding surprises. */
export function toPrice8(value: string | number): bigint {
  const s = typeof value === "number" ? value.toFixed(PRICE_DECIMALS) : value.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`invalid price: ${value}`);
  const [w, f = ""] = s.split(".");
  return BigInt(w!) * PRICE_SCALE + BigInt((f + "00000000").slice(0, PRICE_DECIMALS));
}

export function fromPrice8(v: bigint): number {
  return Number(v) / 1e8;
}

/** Deterministic JSON: sorted keys, no whitespace, bigint as decimal string. */
export function canonicalJson(value: unknown): string {
  const norm = (v: unknown): unknown => {
    if (typeof v === "bigint") return v.toString();
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.keys(v as Record<string, unknown>)
          .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
          .sort()
          .map((k) => [k, norm((v as Record<string, unknown>)[k])]),
      );
    }
    return v;
  };
  return JSON.stringify(norm(value));
}

export function hashCanonical(value: unknown): Hex {
  return keccak256(toBytes(canonicalJson(value)));
}

/** The research document whose hash becomes `contentHash`. Stored off-chain (content-addressed). */
export interface ThesisContent {
  version: 1;
  title: string;
  summary: string;
  body: string;
  market: string; // e.g. "BNBUSDT"
  timeframe: string; // e.g. "1h"
  confidence: number; // 0..100
  sources: string[];
}

export function thesisContentHash(c: ThesisContent): Hex {
  return hashCanonical(c);
}

// ------------------------------------------------------------------ validation (mirrors contract)

export function validateTerms(t: ThesisTerms, startTime: bigint, revealDeadline: bigint): string | null {
  const zero = "0x0000000000000000000000000000000000000000";
  if (t.baseAsset === zero || t.quoteAsset === zero || t.baseAsset.toLowerCase() === t.quoteAsset.toLowerCase()) return "assets";
  if (/^0x0+$/.test(t.methodologyHash)) return "methodology";
  if (/^0x0+$/.test(t.contentHash)) return "content";
  if (t.evaluationDeadline <= startTime) return "deadline";
  if (t.evaluationDeadline > revealDeadline) return "deadline after reveal";
  if (t.target.price === 0n || t.invalidation.price === 0n) return "levels";
  if (t.direction === Direction.Long) {
    if (t.target.comparator !== Comparator.GTE || t.invalidation.comparator !== Comparator.LTE) return "long comparators";
    if (t.target.price <= t.invalidation.price) return "long levels";
  } else if (t.direction === Direction.Short) {
    if (t.target.comparator !== Comparator.LTE || t.invalidation.comparator !== Comparator.GTE) return "short comparators";
    if (t.target.price >= t.invalidation.price) return "short levels";
  } else return "direction";
  if (t.entry.kind === EntryKind.Market) {
    if (t.entry.price !== 0n) return "entry";
  } else {
    const [lo, hi] = t.direction === Direction.Long ? [t.invalidation.price, t.target.price] : [t.target.price, t.invalidation.price];
    if (t.entry.price <= lo || t.entry.price >= hi) return "entry";
  }
  return null;
}

/** API input for a thesis draft (human units). */
export const thesisDraftSchema = z.object({
  asset: z.string().min(2).max(10),
  direction: z.enum(["LONG", "SHORT"]),
  entryKind: z.enum(["MARKET", "AT_OR_BELOW", "AT_OR_ABOVE"]).default("MARKET"),
  entryPrice: z.string().regex(/^\d+(\.\d+)?$/).optional(),
  targetPrice: z.string().regex(/^\d+(\.\d+)?$/),
  invalidationPrice: z.string().regex(/^\d+(\.\d+)?$/),
  horizonHours: z.number().int().min(1).max(24 * 365),
  title: z.string().min(4).max(140),
  summary: z.string().min(10).max(500),
  body: z.string().max(20000).default(""),
  confidence: z.number().int().min(0).max(100).default(60),
  sources: z.array(z.string().url()).max(10).default([]),
  visibility: z.enum(["PUBLIC", "COMMIT_REVEAL"]).default("PUBLIC"),
});
export type ThesisDraftInput = z.infer<typeof thesisDraftSchema>;
