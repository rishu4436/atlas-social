import { keccak256, toBytes, type Hex } from "viem";

/**
 * ATLAS-M1 evaluation methodology. Its hash is committed inside every thesis (methodologyHash), so the
 * rules used to evaluate a thesis are fixed before the market moves.
 */
export const METHODOLOGY_M1 = {
  id: "ATLAS-M1",
  version: 1,
  priceSource: "Binance Spot public klines (GET https://api.binance.com/api/v3/klines), symbol = base/USDT market, interval 1h",
  window: "From on-chain startTime (block timestamp of the commitment) to evaluationDeadline, inclusive of every 1h candle that overlaps the window.",
  entry: "MARKET: entry = open of the first candle in the window. AT_OR_BELOW/AT_OR_ABOVE: entry triggers at the first candle whose low<=price (or high>=price); conditions are only checked after entry.",
  touch: "Target/invalidation are touched when a candle's high (GTE) or low (LTE) crosses the level.",
  ambiguity: "If target and invalidation are both touched inside the same candle, the outcome is UNRESOLVED (never resolved in the author's favour).",
  missingData: "Any gap > 1 candle, a stale feed, or data that does not cover the window => UNRESOLVED.",
  noEntry: "Entry never triggered before the deadline => VOID (no position, excluded from hit rate, counted in sample disclosure).",
  expiry: "Entry triggered, neither level touched by the deadline => EXPIRED, scored at the close of the last candle.",
  returns: "Return in basis points from entry to the exit level (target, invalidation, or last close), direction-adjusted, before fees. Not a realized-P&L claim.",
} as const;

export const METHODOLOGY_M1_TEXT = JSON.stringify(METHODOLOGY_M1);
export const METHODOLOGY_M1_HASH: Hex = keccak256(toBytes(METHODOLOGY_M1_TEXT));
export const METHODOLOGIES: Record<string, typeof METHODOLOGY_M1> = { [METHODOLOGY_M1_HASH]: METHODOLOGY_M1 };
