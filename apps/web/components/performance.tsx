"use client";
import Link from "next/link";
import { motion } from "motion/react";
import { AlertTriangle } from "lucide-react";
import { Card, Badge, Skeleton, AnimatedNumber, StaggerList, StaggerItem, cx } from "@atlas/design-system";
import { useApi, timeAgo } from "@/lib/api";

export function Stat({ label, value, decimals = 0, suffix = "", tone }: { label: string; value: number | null; decimals?: number; suffix?: string; tone?: "up" | "down" }) {
  return (
    <div className="rounded-2xl bg-black/25 p-3">
      <div className="label">{label}</div>
      <div className={cx("num mt-1 text-xl font-semibold", tone === "up" && "text-emerald-up", tone === "down" && "text-coral-down")}>{value == null ? "—" : <AnimatedNumber value={value} decimals={decimals} suffix={suffix} />}</div>
    </div>
  );
}

export function PerformancePanel({ userId }: { userId: string }) {
  const p = useApi<any>(`/performance/${userId}`);
  if (!p.data) return <Skeleton className="h-64" />;
  const s = p.data.stats;
  const total = Math.max(1, s.wins + s.losses + s.unresolved + s.void + s.open);
  const bars = [["Wins", s.wins, "bg-emerald-up"], ["Losses", s.losses, "bg-coral-down"], ["Unresolved", s.unresolved, "bg-amber-warn"], ["Void", s.void, "bg-ink-faint"], ["Open", s.open, "bg-signal"]] as const;
  return (
    <Card hover={false} className="space-y-4 p-5">
      {s.sampleWarning && <p className="flex gap-2 text-xs text-amber-warn"><AlertTriangle className="h-4 w-4 shrink-0" />{s.sampleWarning}</p>}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Reputation" value={s.reputation} decimals={1} />
        <Stat label="Hit rate" value={s.hitRate == null ? null : s.hitRate * 100} decimals={1} suffix="%" />
        <Stat label="Avg return" value={s.avgReturnBps} suffix=" bps" tone={s.avgReturnBps > 0 ? "up" : s.avgReturnBps < 0 ? "down" : undefined} />
        <Stat label="Brier" value={s.brier} decimals={3} />
      </div>
      <div>
        <div className="flex h-2.5 overflow-hidden rounded-full bg-white/5">
          {bars.map(([k, n, c], i) => <motion.div key={k} className={c} initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} style={{ width: `${(n / total) * 100}%`, transformOrigin: "left" }} transition={{ delay: 0.1 + i * 0.08, type: "spring", stiffness: 120, damping: 20 }} />)}
        </div>
        <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-ink-dim">{bars.map(([k, n, c]) => <span key={k} className="inline-flex items-center gap-1"><span className={cx("h-2 w-2 rounded-full", c)} />{k} <span className="num">{n}</span></span>)}<span>Forfeited <span className="num">{s.forfeited}</span></span><span>Verified trades <span className="num">{p.data.verifiedTrades}</span></span></div>
      </div>
      <StaggerList className="divide-y divide-line text-sm">{p.data.history.slice(0, 20).map((h: any) => (
        <StaggerItem key={h.id}><Link href={`/thesis/${h.id}`} className="flex items-center justify-between py-2.5 hover:text-signal">
          <span><Badge tone={h.direction === "LONG" ? "up" : "down"}>{h.direction}</Badge> <span className="ml-1.5">{h.asset}</span></span>
          <span className="num text-xs text-ink-dim">{h.outcome}{h.return_bps != null && ` · ${h.return_bps} bps`} · {timeAgo(h.published_at)}</span>
        </Link></StaggerItem>
      ))}</StaggerList>
      <p className="text-[11px] text-ink-faint">{p.data.disclosure}</p>
    </Card>
  );
}
