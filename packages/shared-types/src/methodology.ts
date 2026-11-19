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

/**
 * ATLAS-M1.1: identical rules to M1, with a declared real-source fallback so a thesis can still be scored when
 * the primary venue refuses the evaluator (e.g. IP bans). Theses committed to M1 stay Binance-only.
 */
export const METHODOLOGY_M1_1 = {
  ...METHODOLOGY_M1,
  id: "ATLAS-M1.1",
  version: 2,
  priceSource: "1h base/USDT spot candles from Binance Spot public klines (GET https://api.binance.com/api/v3/klines); if Binance cannot serve the whole window, OKX public candles (GET https://www.okx.com/api/v5/market/history-candles, instId BASE-USDT, bar 1H). One source is used for the entire window and recorded in the evidence with every attempt.",
  sourcePolicy: "Prices are never simulated. If no listed real source can serve the window (e.g. the market is not listed on either venue), the thesis is UNSCORABLE: it stays visible with the reason and is UNRESOLVED after its deadline.",
} as const;

export const METHODOLOGY_M1_1_TEXT = JSON.stringify(METHODOLOGY_M1_1);
export const METHODOLOGY_M1_1_HASH: Hex = keccak256(toBytes(METHODOLOGY_M1_1_TEXT));

/** Methodology new theses commit to. */
export const METHODOLOGY_CURRENT = METHODOLOGY_M1_1;
export const METHODOLOGY_CURRENT_HASH = METHODOLOGY_M1_1_HASH;

export type OutcomeMethodology = typeof METHODOLOGY_M1 | typeof METHODOLOGY_M1_1;
export const METHODOLOGIES: Record<string, OutcomeMethodology> = { [METHODOLOGY_M1_HASH]: METHODOLOGY_M1, [METHODOLOGY_M1_1_HASH]: METHODOLOGY_M1_1 };

/** Real price sources (market-data provider ids), in priority order, that each committed methodology allows. */
export const PRICE_SOURCES_BY_METHODOLOGY: Record<string, readonly string[]> = {
  [METHODOLOGY_M1_HASH]: ["binance-spot-public"],
  [METHODOLOGY_M1_1_HASH]: ["binance-spot-public", "okx-public"],
};

