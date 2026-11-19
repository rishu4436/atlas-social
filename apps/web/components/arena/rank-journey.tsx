"use client";
import { motion } from "motion/react";
import { Skeleton } from "@atlas/design-system";
import { useApi } from "@/lib/api";
import { TierBadge } from "./shared";

/** Rank Journey: plotted from immutable, versioned leaderboard snapshots (never recomputed with new rules). */
export function RankJourney({ userId, board = "analysts", window = "all", height = 120 }: { userId: string; board?: string; window?: string; height?: number }) {
  const h = useApi<any>(`/leaderboards/${board}/history?window=${window}&userId=${userId}`);
  if (!h.data) return <Skeleton className="h-28" />;
  const pts = (h.data.snapshots as any[]).filter((s) => s.entry);
  if (pts.length < 2) return <p className="rounded-xl bg-white/[0.03] p-3 text-xs text-ink-dim">The Rank Journey starts once this account appears in two or more immutable leaderboard snapshots.</p>;
  const W = 420, H = height, pad = 10;
  const xs = (i: number) => pad + (i / (pts.length - 1)) * (W - 2 * pad);
  const ys = (v: number) => H - pad - (v / 100) * (H - 2 * pad);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${xs(i).toFixed(1)},${ys(p.entry.score).toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  const methods = [...new Set(pts.map((p) => p.methodologyId))];
  return (
    <div data-testid="rank-journey">
      <div className="mb-2 flex items-center justify-between text-xs text-ink-dim">
        <span>Score over {pts.length} snapshots</span>
        <span className="flex items-center gap-2">{last.entry.rank ? <span className="num">#{last.entry.rank}</span> : null}<TierBadge tier={last.entry.tier} /></span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Rank Journey chart">
        <defs><linearGradient id="rj" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#46E1DF" stopOpacity="0.28" /><stop offset="1" stopColor="#46E1DF" stopOpacity="0" /></linearGradient></defs>
        {[25, 50, 75].map((g) => <line key={g} x1={pad} x2={W - pad} y1={ys(g)} y2={ys(g)} stroke="rgb(148 163 184 / .1)" strokeDasharray="3 4" />)}
        <motion.path d={`${d} L${xs(pts.length - 1)},${H - pad} L${pad},${H - pad} Z`} fill="url(#rj)" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6 }} />
        <motion.path d={d} fill="none" stroke="#46E1DF" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }} />
        {pts.map((p, i) => (
          <motion.circle key={p.id} cx={xs(i)} cy={ys(p.entry.score)} r={3.2} fill={p.entry.tier === "Emerging" ? "#FBBF24" : p.entry.tier === "Established" ? "#34D399" : "#46E1DF"} stroke="#080D14" strokeWidth="1.5"
            initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.3 + i * 0.04 }}><title>{`${new Date(p.asOf).toLocaleDateString()} · score ${p.entry.score} · ${p.entry.tier}${p.entry.rank ? ` #${p.entry.rank}` : ""}${p.backfill ? " · backfilled" : ""}`}</title></motion.circle>
        ))}
      </svg>
      <p className="mt-1 text-[10px] text-ink-faint">Methodology {methods.join(", ")} · snapshots are immutable; backfilled points use only evidence available at that date.</p>
    </div>
  );
}
