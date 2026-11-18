"""ATLAS reputation v1 in Python + Polars (batch analytics / leaderboard snapshots).

Must match services/reputation-engine/src/index.ts exactly (parity test in test/parity.test.ts).
Usage:
  python reputation.py records.json            # one author's records -> stats JSON
  python reputation.py --db $DATABASE_URL       # recompute leaderboard snapshots from Postgres
"""
from __future__ import annotations

import json
import math
import sys

import polars as pl

LOSS = ["InvalidationHit", "Expired", "Forfeited"]
WITH_RET = ["TargetHit", "InvalidationHit", "Expired"]
CALIB = ["TargetHit", "InvalidationHit", "Expired", "Forfeited"]


def _round(x: float, d: int = 4) -> float:
    # mirror JS Math.round(x * 10**d) / 10**d (round half up toward +inf)
    return math.floor(x * 10**d + 0.5) / 10**d


def wilson_lower(wins: int, n: int, z: float = 1.96):
    if n == 0:
        return None
    p = wins / n
    denom = 1 + z * z / n
    centre = p + z * z / (2 * n)
    margin = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return (centre - margin) / denom


def compute_performance(df: pl.DataFrame) -> dict:
    df = df.filter(pl.col("onchain"))
    if "cancelledAfterStart" not in df.columns:
        df = df.with_columns(pl.lit(False).alias("cancelledAfterStart"))
    df = df.with_columns(pl.col("cancelledAfterStart").fill_null(False))
    cnt = lambda o: df.filter(pl.col("outcome") == o).height  # noqa: E731
    wins = cnt("TargetHit")
    cancelled_loss = df.filter((pl.col("outcome") == "Cancelled") & pl.col("cancelledAfterStart")).height
    losses = sum(cnt(o) for o in LOSS) + cancelled_loss
    scored = wins + losses
    rets_df = (
        df.filter(pl.col("returnBps").is_not_null() & pl.col("outcome").is_in(WITH_RET))
        .with_columns(pl.col("resolvedAt").fill_null(0))
        .sort("resolvedAt", maintain_order=True)
    )
    rets = rets_df["returnBps"].cast(pl.Float64).to_list() if rets_df.height else []
    cum = peak = mdd = 0.0
    for x in rets:
        cum += x
        peak = max(peak, cum)
        mdd = max(mdd, peak - cum)
    avg = (sum(rets) / len(rets)) if rets else None
    cal = df.filter(pl.col("outcome").is_in(CALIB))
    brier = None
    if cal.height:
        brier = (
            cal.with_columns(
                ((pl.col("confidence") / 100 - (pl.col("outcome") == "TargetHit").cast(pl.Float64)) ** 2).alias("sq")
            )["sq"].sum()
            / cal.height
        )
    shrunk = (wins + 5) / (scored + 10)
    exp_score = 0.5 if avg is None else 1 / (1 + math.exp(-avg / 300))
    cal_score = 0.5 if brier is None else 1 - brier
    sample_factor = scored / (scored + 5)
    reputation = 100 * sample_factor * (0.6 * shrunk + 0.25 * exp_score + 0.15 * cal_score)
    wl = wilson_lower(wins, scored)
    return {
        "methodologyVersion": 1,
        "published": df.height,
        "scored": scored,
        "wins": wins,
        "losses": losses,
        "expired": cnt("Expired"),
        "unresolved": cnt("Unresolved"),
        "void": cnt("Void"),
        "open": cnt("Open"),
        "forfeited": cnt("Forfeited"),
        "hitRate": _round(wins / scored) if scored else None,
        "wilsonLower": _round(wl) if scored else None,
        "shrunkHitRate": _round(shrunk),
        "avgReturnBps": None if avg is None else _round(avg, 2),
        "expectancyBps": None if avg is None else _round(avg, 2),
        "cumulativeReturnBps": _round(cum, 2),
        "maxDrawdownBps": _round(mdd, 2),
        "brier": None if brier is None else _round(brier),
        "reputation": _round(reputation, 2),
        "sampleWarning": None if scored >= 10 else f"Small sample: {scored} scored theses. Treat statistics as low-confidence.",
    }


def records_frame(records: list[dict]) -> pl.DataFrame:
    schema = {
        "outcome": pl.Utf8,
        "returnBps": pl.Float64,
        "confidence": pl.Float64,
        "onchain": pl.Boolean,
        "resolvedAt": pl.Int64,
        "cancelledAfterStart": pl.Boolean,
    }
    rows = [{k: r.get(k) for k in schema} for r in records]
    return pl.DataFrame(rows, schema=schema)


def leaderboard_from_db(url: str) -> list[dict]:
    import psycopg  # optional dependency for batch mode

    with psycopg.connect(url) as conn:
        rows = conn.execute(
            """select t.author_id, t.outcome, t.return_bps, t.confidence, t.chain_status = 'CONFIRMED',
                      extract(epoch from t.resolved_at)::bigint, t.cancelled_after_start
               from theses t"""
        ).fetchall()
        df = pl.DataFrame(
            rows,
            schema=["author", "outcome", "returnBps", "confidence", "onchain", "resolvedAt", "cancelledAfterStart"],
            orient="row",
        )
        out = []
        for (author,), g in df.group_by(["author"], maintain_order=True):
            stats = compute_performance(g.drop("author"))
            out.append({"userId": author, **stats})
            conn.execute(
                "insert into performance_snapshots (user_id, stats, computed_by) values (%s, %s, 'python-polars')",
                (author, json.dumps(stats)),
            )
        conn.commit()
        return out


if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "--db":
        print(json.dumps(leaderboard_from_db(sys.argv[2])))
    else:
        data = json.load(open(sys.argv[1])) if len(sys.argv) > 1 else json.load(sys.stdin)
        print(json.dumps(compute_performance(records_frame(data))))
