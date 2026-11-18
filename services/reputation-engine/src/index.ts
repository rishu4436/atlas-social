/**
 * ATLAS reputation methodology v1 (published at /performance/methodology).
 * Evidence-weighted, NOT profit-ranked: hit rate is Bayesian-shrunk toward 50% for small samples,
 * forfeits and post-start cancellations count as losses, unresolved/void/open are disclosed separately.
 * The Python/Polars implementation in ./analytics must produce identical numbers (parity-tested).
 */
export type OutcomeName = "TargetHit" | "InvalidationHit" | "Expired" | "Unresolved" | "Void" | "Forfeited" | "Open" | "Cancelled";

export interface ThesisRecord {
  outcome: OutcomeName;
  returnBps: number | null;
  confidence: number; // 0..100 as declared by the author
  onchain: boolean; // only on-chain committed theses count toward reputation
  resolvedAt: number | null; // unix s; ordering for drawdown
  cancelledAfterStart?: boolean;
}

export interface PerformanceStats {
  methodologyVersion: 1;
  published: number;
  scored: number; // wins + losses
  wins: number;
  losses: number; // invalidation + forfeits + post-start cancels
  expired: number;
  unresolved: number;
  void: number;
  open: number;
  forfeited: number;
  hitRate: number | null; // wins / scored
  wilsonLower: number | null; // 95% lower bound
  shrunkHitRate: number; // (wins + 5) / (scored + 10)
  avgReturnBps: number | null; // over records with returnBps
  expectancyBps: number | null;
  cumulativeReturnBps: number;
  maxDrawdownBps: number;
  brier: number | null; // calibration of declared confidence vs target hit
  reputation: number; // 0..100
  sampleWarning: string | null;
}

const round = (x: number, d = 4) => Math.round(x * 10 ** d) / 10 ** d;

export function wilsonLower(wins: number, n: number, z = 1.96): number | null {
  if (n === 0) return null;
  const p = wins / n;
  const denom = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return (centre - margin) / denom;
}

export function computePerformance(records: ThesisRecord[]): PerformanceStats {
  const rs = records.filter((r) => r.onchain);
  const count = (o: OutcomeName) => rs.filter((r) => r.outcome === o).length;
  const wins = count("TargetHit");
  const cancelledLoss = rs.filter((r) => r.outcome === "Cancelled" && r.cancelledAfterStart).length;
  const forfeited = count("Forfeited");
  const expired = count("Expired");
  // Expired with positive return is a partial win only in returns, not in hit rate: counts as a loss for hit rate.
  const losses = count("InvalidationHit") + forfeited + cancelledLoss + expired;
  const scored = wins + losses;
  const withRet = rs
    .filter((r) => r.returnBps !== null && ["TargetHit", "InvalidationHit", "Expired"].includes(r.outcome))
    .sort((a, b) => (a.resolvedAt ?? 0) - (b.resolvedAt ?? 0));
  const rets = withRet.map((r) => r.returnBps as number);
  let cum = 0, peak = 0, mdd = 0;
  for (const x of rets) {
    cum += x;
    peak = Math.max(peak, cum);
    mdd = Math.max(mdd, peak - cum);
  }
  const avg = rets.length ? rets.reduce((s, x) => s + x, 0) / rets.length : null;
  const calib = rs.filter((r) => ["TargetHit", "InvalidationHit", "Expired", "Forfeited"].includes(r.outcome));
  const brier = calib.length ? calib.reduce((s, r) => s + (r.confidence / 100 - (r.outcome === "TargetHit" ? 1 : 0)) ** 2, 0) / calib.length : null;
  const shrunk = (wins + 5) / (scored + 10);
  const expectancyScore = avg === null ? 0.5 : 1 / (1 + Math.exp(-avg / 300));
  const calibScore = brier === null ? 0.5 : 1 - brier;
  const sampleFactor = scored / (scored + 5);
  const reputation = 100 * sampleFactor * (0.6 * shrunk + 0.25 * expectancyScore + 0.15 * calibScore);
  return {
    methodologyVersion: 1,
    published: rs.length,
    scored,
    wins,
    losses,
    expired,
    unresolved: count("Unresolved"),
    void: count("Void"),
    open: count("Open"),
    forfeited,
    hitRate: scored ? round(wins / scored) : null,
    wilsonLower: scored ? round(wilsonLower(wins, scored)!) : null,
    shrunkHitRate: round(shrunk),
    avgReturnBps: avg === null ? null : round(avg, 2),
    expectancyBps: avg === null ? null : round(avg, 2),
    cumulativeReturnBps: round(cum, 2),
    maxDrawdownBps: round(mdd, 2),
    brier: brier === null ? null : round(brier),
    reputation: round(reputation, 2),
    sampleWarning: scored < 10 ? `Small sample: ${scored} scored theses. Treat statistics as low-confidence.` : null,
  };
}

export const METHODOLOGY_TEXT = `ATLAS reputation v1
- Counts only theses committed on-chain (AtlasThesisRegistry) and evaluated with ATLAS-M1.
- Wins: TargetHit. Losses: InvalidationHit, Expired, Forfeited (unrevealed past deadline or cancelled before reveal), cancellations after the window started.
- Disclosed but not scored: Unresolved (data ambiguity), Void (entry never triggered), Open.
- hitRate = wins / scored; wilsonLower = 95% Wilson lower bound; shrunkHitRate = (wins+5)/(scored+10).
- Returns are direction-adjusted basis points from entry to exit before fees. They are outcome reports, NOT realized P&L.
- maxDrawdown = largest peak-to-trough drop of the cumulative return series ordered by resolution time.
- brier = mean((confidence/100 - hit)^2) over scored theses (calibration of declared confidence).
- reputation = 100 * scored/(scored+5) * (0.6*shrunkHitRate + 0.25*sigmoid(avgReturnBps/300) + 0.15*(1-brier)).
- Follower counts and engagement never affect reputation.`;
