import type { Hex } from "viem";
import {
  Comparator, Direction, EntryKind, OutcomeKind, fromPrice8, hashCanonical, METHODOLOGY_M1, METHODOLOGY_M1_HASH,
  METHODOLOGIES, PRICE_SOURCES_BY_METHODOLOGY, type ThesisTerms,
} from "@atlas/shared-types";
import { checkCoverage, INTERVAL_MS, type Candle, type MarketDataProvider } from "@atlas/market-data";

export type EvalStatus = "OPEN" | "RESOLVED";

export interface Evaluation {
  status: EvalStatus;
  outcome: OutcomeKind; // None while OPEN
  outcomeLabel: string;
  entryPrice: number | null;
  entryAt: number | null; // unix s
  exitPrice: number | null;
  observedAt: number | null; // unix s, within window
  returnBps: number | null; // direction-adjusted, before fees; NOT realized P&L
  notes: string[];
  evidence: OutcomeEvidence;
  evidenceHash: Hex;
}

export interface OutcomeEvidence {
  methodology: { id: string; hash: Hex };
  symbol: string;
  interval: "1h";
  source: string;
  simulated: boolean;
  window: { start: number; end: number };
  levels: { direction: string; entryKind: string; entry: number; target: number; invalidation: number };
  candles: [number, number, number, number, number][]; // [openTime ms, o, h, l, c]
  result: { outcome: string; entryPrice: number | null; exitPrice: number | null; observedAt: number | null; returnBps: number | null };
  /** Every real source tried, in order, for this evaluation (present when evaluated through evaluateWithSources). */
  sourceAttempts?: SourceAttempt[];
  /** Set when no allowed real source could serve the window; the thesis cannot be scored. */
  unscorable?: string;
}

export interface SourceAttempt { source: string; ok: boolean; error?: string }

const LABEL: Record<OutcomeKind, string> = {
  [OutcomeKind.None]: "Open",
  [OutcomeKind.TargetHit]: "Target hit",
  [OutcomeKind.InvalidationHit]: "Invalidated",
  [OutcomeKind.Expired]: "Expired",
  [OutcomeKind.Unresolved]: "Unresolved",
  [OutcomeKind.Void]: "Void (no entry)",
  [OutcomeKind.Forfeited]: "Forfeited",
};
export const outcomeLabel = (o: OutcomeKind) => LABEL[o];

const touches = (c: Candle, cmp: Comparator, level: number) => (cmp === Comparator.GTE ? c.high >= level : c.low <= level);

/**
 * Pure, deterministic ATLAS-M1 evaluation. Same inputs => same evidence hash, so anyone can reproduce it.
 * Never resolves ambiguity in the author's favour: same-candle double touches and data gaps => Unresolved.
 */
export function evaluateThesis(args: {
  terms: ThesisTerms;
  startTime: number; // on-chain startTime (unix s)
  symbol: string;
  candles: Candle[]; // 1h candles
  now: number; // unix s
  source: string;
  simulated: boolean;
  sourceAttempts?: SourceAttempt[];
  unscorable?: string;
}): Evaluation {
  const { terms, startTime, symbol, now } = args;
  const end = Number(terms.evaluationDeadline);
  const step = INTERVAL_MS["1h"];
  const startMs = startTime * 1000;
  const endMs = end * 1000;
  const target = fromPrice8(terms.target.price);
  const inval = fromPrice8(terms.invalidation.price);
  const entryLevel = fromPrice8(terms.entry.price);
  const long = terms.direction === Direction.Long;
  const notes: string[] = [];

  // Only full candles that start inside the window and are closed as of `now`.
  const window = args.candles
    .filter((c) => c.openTime >= startMs && c.openTime <= endMs && c.closeTime <= now * 1000)
    .sort((a, b) => a.openTime - b.openTime);
  const deadlinePassed = now > end;
  const coverEnd = Math.min(endMs, now * 1000);
  const firstFull = Math.ceil(startMs / step) * step;
  const coverage = window.length ? checkCoverage(window, "1h", firstFull, Math.floor(coverEnd / step) * step - 1) : { ok: false, issues: ["no data"] };

  let outcome = OutcomeKind.None;
  let entryPrice: number | null = null;
  let entryAt: number | null = null;
  let exitPrice: number | null = null;
  let observedAt: number | null = null;

  const finish = (o: OutcomeKind, exit: number | null, at: number | null) => {
    outcome = o;
    exitPrice = exit;
    observedAt = at;
  };

  for (let i = 0; i < window.length && outcome === OutcomeKind.None; i++) {
    const c = window[i]!;
    const at = Math.max(startTime, Math.floor(c.openTime / 1000));
    if (entryPrice === null) {
      if (terms.entry.kind === EntryKind.Market) {
        entryPrice = c.open;
        entryAt = at;
      } else {
        const hit = terms.entry.kind === EntryKind.AtOrBelow ? c.low <= entryLevel : c.high >= entryLevel;
        if (!hit) continue;
        entryPrice = entryLevel;
        entryAt = at;
        // Limit entry candle: cannot sequence entry vs exits inside one candle.
        if (touches(c, terms.target.comparator, target) || touches(c, terms.invalidation.comparator, inval)) {
          notes.push("entry and an exit level touched in the same candle; sequencing unknown");
          finish(OutcomeKind.Unresolved, null, null);
          break;
        }
        continue;
      }
    }
    const t = touches(c, terms.target.comparator, target);
    const v = touches(c, terms.invalidation.comparator, inval);
    if (t && v) {
      notes.push("target and invalidation touched in the same candle; sequencing unknown");
      finish(OutcomeKind.Unresolved, null, null);
    } else if (t) finish(OutcomeKind.TargetHit, target, at);
    else if (v) finish(OutcomeKind.InvalidationHit, inval, at);
  }

  if (outcome === OutcomeKind.None && !coverage.ok && (deadlinePassed || window.length === 0)) {
    if (deadlinePassed) {
      notes.push(...coverage.issues);
      finish(OutcomeKind.Unresolved, null, null);
    } else notes.push(...coverage.issues);
  } else if (!coverage.ok) {
    notes.push(...coverage.issues.map((x) => `data issue: ${x}`));
    if (outcome !== OutcomeKind.None && outcome !== OutcomeKind.Unresolved) {
      // A touch observed after a gap cannot be trusted to be the first touch.
      notes.push("data gap before the observed touch; outcome cannot be established");
      finish(OutcomeKind.Unresolved, null, null);
    }
  }

  if (outcome === OutcomeKind.None && deadlinePassed) {
    if (entryPrice === null) finish(OutcomeKind.Void, null, null);
    else {
      const last = window[window.length - 1]!;
      finish(OutcomeKind.Expired, last.close, end);
    }
  }

  const status: EvalStatus = outcome === OutcomeKind.None ? "OPEN" : "RESOLVED";
  let returnBps: number | null = null;
  if (entryPrice !== null && exitPrice !== null) {
    const r = long ? (exitPrice - entryPrice) / entryPrice : (entryPrice - exitPrice) / entryPrice;
    returnBps = Math.round(r * 10000);
  }
  const evidence: OutcomeEvidence = {
    methodology: METHODOLOGIES[terms.methodologyHash]
      ? { id: METHODOLOGIES[terms.methodologyHash]!.id, hash: terms.methodologyHash as Hex }
      : { id: METHODOLOGY_M1.id, hash: METHODOLOGY_M1_HASH },
    symbol,
    interval: "1h",
    source: args.source,
    simulated: args.simulated,
    window: { start: startTime, end },
    levels: {
      direction: long ? "LONG" : "SHORT",
      entryKind: EntryKind[terms.entry.kind],
      entry: entryLevel,
      target,
      invalidation: inval,
    },
    candles: window.map((c) => [c.openTime, c.open, c.high, c.low, c.close]),
    result: { outcome: OutcomeKind[outcome], entryPrice, exitPrice, observedAt, returnBps },
    ...(args.sourceAttempts ? { sourceAttempts: args.sourceAttempts } : {}),
    ...(args.unscorable ? { unscorable: args.unscorable } : {}),
  };
  if (args.unscorable) notes.push(`unscorable: ${args.unscorable}`);
  return { status, outcome, outcomeLabel: LABEL[outcome], entryPrice, entryAt, exitPrice, observedAt, returnBps, notes, evidence, evidenceHash: hashCanonical(evidence) };
}

/** Recompute an evaluation from published evidence and confirm the hash (third-party reproducibility). */
export function verifyEvidence(evidence: OutcomeEvidence, claimedHash: Hex): boolean {
  return hashCanonical(evidence) === claimedHash;
}

async function fetchWindow(provider: MarketDataProvider, args: { terms: ThesisTerms; startTime: number; symbol: string }, now: number) {
  const end = Math.min(Number(args.terms.evaluationDeadline), now);
  const candles: Candle[] = [];
  let cursor = args.startTime * 1000;
  while (cursor <= end * 1000) {
    const batch = await provider.klines(args.symbol, "1h", { startTime: cursor, endTime: end * 1000, limit: 1000 });
    if (!batch.length) break;
    candles.push(...batch);
    cursor = batch[batch.length - 1]!.openTime + INTERVAL_MS["1h"];
    if (batch.length < 1000) break;
  }
  return candles;
}

/** Single-provider evaluation (dev/tests; also used with SIMULATED data, which is labelled in the evidence). */
export async function evaluateWithProvider(provider: MarketDataProvider, args: { terms: ThesisTerms; startTime: number; symbol: string; now?: number }) {
  const now = args.now ?? Math.floor(Date.now() / 1000);
  const candles = await fetchWindow(provider, args, now);
  return evaluateThesis({ ...args, candles, now, source: provider.id, simulated: provider.simulated });
}

export type SourcedEvaluation = Evaluation & { scorable: boolean; reason: string | null; attempts: SourceAttempt[] };

/**
 * Production evaluation: tries the REAL sources the thesis's committed methodology allows, in order, and uses ONE
 * source for the whole window. Simulated providers are never used. Every attempt is recorded in the evidence.
 * If no allowed source can serve the window, the result is unscorable (OPEN with a reason before the deadline,
 * UNRESOLVED after it) — prices are never invented.
 */
export async function evaluateWithSources(sources: MarketDataProvider[], args: { terms: ThesisTerms; startTime: number; symbol: string; now?: number }): Promise<SourcedEvaluation> {
  const now = args.now ?? Math.floor(Date.now() / 1000);
  const allowed = PRICE_SOURCES_BY_METHODOLOGY[args.terms.methodologyHash] ?? PRICE_SOURCES_BY_METHODOLOGY[METHODOLOGY_M1_HASH]!;
  const usable = allowed.map((id) => sources.find((s) => s.id === id && !s.simulated)).filter((s): s is MarketDataProvider => !!s);
  const attempts: SourceAttempt[] = [];
  for (const src of usable) {
    try {
      const candles = await fetchWindow(src, args, now);
      attempts.push({ source: src.id, ok: true });
      const ev = evaluateThesis({ ...args, candles, now, source: src.id, simulated: false, sourceAttempts: [...attempts] });
      return { ...ev, scorable: true, reason: null, attempts };
    } catch (e) {
      attempts.push({ source: src.id, ok: false, error: String((e as Error)?.message ?? e).slice(0, 160) });
    }
  }
  const reason = usable.length
    ? `No allowed real price source could serve ${args.symbol}: ${attempts.map((a) => `${a.source}: ${a.error}`).join("; ")}`
    : `No allowed real price source is configured for ${args.symbol} under this methodology`;
  const ev = evaluateThesis({ ...args, candles: [], now, source: "none", simulated: false, sourceAttempts: attempts, unscorable: reason });
  return { ...ev, scorable: false, reason, attempts };
}
