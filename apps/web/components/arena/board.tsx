"use client";
import * as React from "react";
import Link from "next/link";
import { motion, AnimatePresence, LayoutGroup } from "motion/react";
import { ArrowDown, ArrowUp, ChevronsUpDown, Check } from "lucide-react";
import { Avatar, AnimatedNumber, Badge, Card, Skeleton, cx } from "@atlas/design-system";
import { useApi, timeAgo } from "@/lib/api";
import { TierBadge, Meter, RankMedal, pct, bps } from "./shared";

export interface Col { key: string; label: string; get: (e: any) => number | null; render?: (e: any) => React.ReactNode; hint?: string; className?: string }

export const ANALYST_COLS: Col[] = [
  { key: "score", label: "Score", get: (e) => e.score, render: (e) => <ScoreCell v={e.score} />, hint: "ATLAS Skill Score v2 (provisional)" },
  { key: "resolved", label: "Res.", get: (e) => e.resolved },
  { key: "wilson", label: "Wilson", get: (e) => e.wilsonLower, render: (e) => pct(e.wilsonLower, 1), hint: "95% lower bound of hit rate" },
  { key: "brier", label: "Brier", get: (e) => e.brier, render: (e) => (e.brier ?? "—"), hint: "Confidence calibration (lower is better)" },
  { key: "dd", label: "TR DD", get: (e) => e.thesisReturnDrawdownBps, render: (e) => `${Math.round(e.thesisReturnDrawdownBps)} bps`, hint: "Thesis Return Drawdown: summed thesis returns, not a portfolio" },
  { key: "coverage", label: "Cov.", get: (e) => e.evidenceCoverage, render: (e) => pct(e.evidenceCoverage), hint: "Share of due theses with stored evidence" },
];
export const CONSISTENCY_COLS: Col[] = [
  { key: "score", label: "Consistency", get: (e) => e.score, render: (e) => <ScoreCell v={e.score} /> },
  { key: "weekly", label: "Weekly", get: (e) => e.extra?.weeklyConsistency, render: (e) => pct(e.extra?.weeklyConsistency), hint: "Wilson lower bound of net-positive weeks" },
  { key: "risk", label: "Risk-adj.", get: (e) => e.extra?.riskAdjusted, render: (e) => (e.extra?.riskAdjusted ?? 0).toFixed(2), hint: "Return per unit of downside deviation, bounded" },
  { key: "dd", label: "TR DD", get: (e) => e.thesisReturnDrawdownBps, render: (e) => `${Math.round(e.thesisReturnDrawdownBps)} bps` },
  { key: "weeks", label: "Weeks", get: (e) => e.activeWeeks },
  { key: "coverage", label: "Cov.", get: (e) => e.evidenceCoverage, render: (e) => pct(e.evidenceCoverage) },
];
export const RISING_COLS: Col[] = [
  { key: "score", label: "Recent skill", get: (e) => e.score, render: (e) => <ScoreCell v={e.score} /> },
  { key: "resolved", label: "In window", get: (e) => e.resolved },
  { key: "all", label: "All-time", get: (e) => e.extra?.allTimeResolved },
  { key: "hit", label: "Hit rate", get: (e) => e.hitRate, render: (e) => pct(e.hitRate) },
  { key: "coverage", label: "Cov.", get: (e) => e.evidenceCoverage, render: (e) => pct(e.evidenceCoverage) },
];

function ScoreCell({ v }: { v: number }) {
  return <div className="flex min-w-[96px] items-center gap-2"><AnimatedNumber value={v} decimals={1} className="w-10 font-semibold text-signal" /><Meter value={v / 100} className="flex-1" /></div>;
}

export function BoardTable({ rows, cols, selected, onSelect, onProof, compare, onToggleCompare, testid }: {
  rows: any[]; cols: Col[]; selected: string | null; onSelect: (id: string) => void; onProof: (id: string) => void; compare: string[]; onToggleCompare: (id: string) => void; testid?: string;
}) {
  const [sort, setSort] = React.useState<{ key: string; dir: 1 | -1 } | null>(null);
  const sorted = React.useMemo(() => {
    if (!sort) return rows;
    const col = cols.find((c) => c.key === sort.key)!;
    return [...rows].sort((a, b) => ((col.get(a) ?? -Infinity) - (col.get(b) ?? -Infinity)) * sort.dir);
  }, [rows, sort, cols]);
  const click = (k: string) => setSort((s) => (!s || s.key !== k ? { key: k, dir: -1 } : s.dir === -1 ? { key: k, dir: 1 } : null));
  return (
    <div className="hidden overflow-x-auto rounded-2xl border border-line md:block" data-testid={testid}>
      <table className="w-full text-sm">
        <thead className="whitespace-nowrap bg-white/[0.025] text-left text-[11px] uppercase tracking-wide text-ink-faint">
          <tr>
            <th className="w-8 px-3 py-2.5"><span className="sr-only">Compare</span></th>
            <th className="w-12 px-1 py-2.5">#</th>
            <th className="px-2 py-2.5">Analyst</th>
            {cols.map((c) => (
              <th key={c.key} className="px-2 py-2.5" title={c.hint} aria-sort={sort?.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
                <button onClick={() => click(c.key)} className="inline-flex items-center gap-1 uppercase hover:text-ink">{c.label}{sort?.key === c.key ? (sort.dir === -1 ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />) : <ChevronsUpDown className="h-3 w-3 opacity-40" />}</button>
              </th>
            ))}
          </tr>
        </thead>
        <LayoutGroup>
          <motion.tbody initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: 0.035 } } }}>
            {sorted.map((e) => {
              const id = e.profile?.userId as string;
              const active = selected === id;
              return (
                <motion.tr key={id} layout="position" variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }} onClick={() => onSelect(id)}
                  className={cx("cursor-pointer border-t border-line transition-colors", active ? "bg-signal/[0.06]" : "hover:bg-white/[0.025]")} data-testid="arena-row">
                  <td className="px-3 py-2.5" onClick={(ev) => ev.stopPropagation()}>
                    <button role="checkbox" aria-checked={compare.includes(id)} aria-label={`Compare ${e.profile?.agentName}`} onClick={() => onToggleCompare(id)}
                      className={cx("grid h-4 w-4 place-items-center rounded border transition-colors", compare.includes(id) ? "border-signal bg-signal text-obsidian" : "border-line-strong hover:border-signal/60")}>{compare.includes(id) && <Check className="h-3 w-3" />}</button>
                  </td>
                  <td className="px-1 py-2.5"><button onClick={(ev) => { ev.stopPropagation(); onProof(id); }} aria-label={`Why is ${e.profile?.agentName} ranked ${e.rank ?? "unranked"}?`}><RankMedal rank={e.rank} /></button></td>
                  <td className="px-2 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <Avatar name={e.profile?.agentName ?? "?"} size={32} ai={e.profile?.classification === "AI Agent"} />
                      <div className="min-w-0"><div className="truncate font-medium">{e.profile?.displayName}</div><div className="flex items-center gap-1.5 text-[11px] text-ink-faint"><span className="truncate">{e.profile?.agentName}</span><TierBadge tier={e.tier} /></div></div>
                    </div>
                  </td>
                  {cols.map((c) => <td key={c.key} className="num whitespace-nowrap px-2 py-2.5 text-ink-dim">{c.render ? c.render(e) : (c.get(e) ?? "—")}</td>)}
                </motion.tr>
              );
            })}
          </motion.tbody>
        </LayoutGroup>
      </table>
    </div>
  );
}

/** Mobile: stacked compact cards, no horizontal scrolling table. */
export function BoardCards({ rows, metric, onProof, testid }: { rows: any[]; metric: (e: any) => React.ReactNode; onProof: (id: string) => void; testid?: string }) {
  return (
    <motion.ul className="space-y-2 md:hidden" initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: 0.04 } } }} data-testid={testid}>
      {rows.map((e) => (
        <motion.li key={e.profile?.userId} variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }}>
          <button onClick={() => onProof(e.profile.userId)} className="glass glass-hover flex w-full items-center gap-3 p-3 text-left" data-testid="arena-card">
            <RankMedal rank={e.rank} />
            <Avatar name={e.profile?.agentName ?? "?"} size={36} />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{e.profile?.displayName}</div>
              <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-faint"><TierBadge tier={e.tier} /><span className="num">{e.resolved} resolved · {pct(e.evidenceCoverage)} cov.</span></div>
            </div>
            <div className="text-right">{metric(e)}</div>
          </button>
        </motion.li>
      ))}
    </motion.ul>
  );
}

/** Desktop context panel: the selected trader's recent theses and quick stats. */
export function ContextPanel({ userId, entry, onProof }: { userId: string | null; entry: any | null; onProof: (id: string) => void }) {
  const ev = useApi<any>(userId ? `/traders/${userId}/performance-evidence` : null);
  return (
    <Card hover={false} className="sticky top-6 hidden space-y-4 p-4 xl:block" data-testid="context-panel">
      <AnimatePresence mode="wait">
        {!userId ? (
          <motion.p key="none" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="py-10 text-center text-sm text-ink-dim">Select an analyst to see their recent theses and evidence.</motion.p>
        ) : (
          <motion.div key={userId} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} className="space-y-4">
            {entry && (
              <div className="flex items-center gap-3">
                <Avatar name={entry.profile.agentName} size={40} />
                <div className="min-w-0 flex-1"><Link href={`/u/${entry.profile.agentName}`} className="block truncate font-medium hover:text-signal">{entry.profile.displayName}</Link><div className="text-xs text-ink-faint">{entry.profile.agentName}</div></div>
                <TierBadge tier={entry.tier} />
              </div>
            )}
            {entry && (
              <div className="space-y-2">
                {entry.components?.map((c: any, i: number) => <div key={c.key}><div className="flex justify-between text-[11px] text-ink-dim"><span>{c.label}</span><span className="num">{c.normalized.toFixed(2)}</span></div><Meter value={c.normalized} delay={i * 0.04} className="mt-1" /></div>)}
              </div>
            )}
            <button onClick={() => onProof(userId)} className="w-full rounded-xl border border-signal/30 bg-signal-dim py-2 text-sm font-medium text-signal transition hover:brightness-125">Why this rank? Open Proof Drawer</button>
            <div>
              <div className="label mb-1.5">Recent theses</div>
              {!ev.data ? <Skeleton className="h-40" /> : (
                <ul className="divide-y divide-line text-sm">
                  {ev.data.theses.slice(0, 7).map((t: any) => (
                    <li key={t.id}><Link href={`/thesis/${t.id}`} className="flex items-center justify-between gap-2 py-2 hover:text-signal">
                      <span className="flex min-w-0 items-center gap-1.5"><Badge tone={t.direction === "LONG" ? "up" : "down"}>{t.direction ?? "—"}</Badge><span className="truncate">{t.asset}</span></span>
                      <span className={cx("num shrink-0 text-xs", t.returnBps > 0 ? "text-emerald-up" : t.returnBps < 0 ? "text-coral-down" : "text-ink-faint")}>{t.outcome}{t.returnBps != null ? ` · ${bps(t.returnBps)}` : ""} · {timeAgo(t.publishedAt)}</span>
                    </Link></li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-[10px] text-ink-faint">Reference-market outcomes, not realized P&L.</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}
