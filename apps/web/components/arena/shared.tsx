"use client";
import * as React from "react";
import { motion } from "motion/react";
import { Badge, cx } from "@atlas/design-system";
import { FlaskConical, ShieldCheck, Sprout, CircleDashed, Award } from "lucide-react";

export type BoardType = "analysts" | "gainers" | "consistency" | "rising" | "contributors" | "squads";
export type Win = "24h" | "7d" | "30d" | "90d" | "all";
export const WINDOW_LABEL: Record<Win, string> = { "24h": "24h", "7d": "7 days", "30d": "30 days", "90d": "90 days", all: "All time" };

export function TierBadge({ tier }: { tier: string }) {
  const map: Record<string, { tone: "signal" | "up" | "warn" | "neutral"; icon: React.ReactNode }> = {
    Established: { tone: "up", icon: <Award className="h-3 w-3" /> },
    Ranked: { tone: "signal", icon: <ShieldCheck className="h-3 w-3" /> },
    Emerging: { tone: "warn", icon: <Sprout className="h-3 w-3" /> },
    Unranked: { tone: "neutral", icon: <CircleDashed className="h-3 w-3" /> },
  };
  const m = map[tier] ?? map.Unranked!;
  return <Badge tone={m.tone}>{m.icon}{tier}</Badge>;
}

export function DemoBadge({ className }: { className?: string }) {
  return <Badge tone="ai" className={className}><FlaskConical className="h-3 w-3" />Demo data</Badge>;
}

/** Horizontal bar that grows from the left (transform only, respects reduced motion via MotionConfig). */
export function Meter({ value, className, tone = "signal", delay = 0 }: { value: number; className?: string; tone?: "signal" | "up" | "down" | "warn"; delay?: number }) {
  const c = { signal: "from-signal/70 to-signal", up: "from-emerald-up/60 to-emerald-up", down: "from-coral-down/60 to-coral-down", warn: "from-amber-warn/60 to-amber-warn" }[tone];
  return (
    <div className={cx("h-1.5 overflow-hidden rounded-full bg-white/[0.06]", className)}>
      <motion.div className={cx("h-full rounded-full bg-gradient-to-r", c)} style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, transformOrigin: "left" }}
        initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ type: "spring", stiffness: 120, damping: 22, delay }} />
    </div>
  );
}

export function RankMedal({ rank }: { rank: number | null }) {
  if (rank === null) return <span className="num inline-grid h-8 w-8 place-items-center text-ink-faint">—</span>;
  const top = rank <= 3;
  const ring = rank === 1 ? "from-signal to-emerald-up" : rank === 2 ? "from-slate-300 to-slate-500" : rank === 3 ? "from-amber-300 to-amber-600" : "";
  return (
    <span className={cx("num relative inline-grid h-8 w-8 place-items-center rounded-full text-sm font-semibold", top ? "text-obsidian" : "text-ink-dim bg-white/[0.04]")}>
      {top && <span className={cx("absolute inset-0 rounded-full bg-gradient-to-br", ring)} />}
      {rank === 1 && <motion.span aria-hidden className="absolute -inset-1 rounded-full border border-signal/50" animate={{ scale: [1, 1.18, 1], opacity: [0.7, 0, 0.7] }} transition={{ duration: 2.6, repeat: Infinity }} />}
      <span className="relative">{rank}</span>
    </span>
  );
}

export const pct = (v: number | null | undefined, d = 0) => (v == null ? "—" : `${(v * 100).toFixed(d)}%`);
export const bps = (v: number | null | undefined) => (v == null ? "—" : `${v > 0 ? "+" : ""}${Math.round(v)} bps`);
export const fmtTime = (s?: string | null) => (s ? new Date(s).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
export const fmtDate = (s?: string | null) => (s ? new Date(s).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—");
