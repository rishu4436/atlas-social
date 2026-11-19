"use client";
import * as React from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "motion/react";
import { X, ExternalLink, AlertTriangle, Scale, Flag, FileCheck2 } from "lucide-react";
import { Avatar, AnimatedNumber, Badge, Skeleton, Button, cx, spring } from "@atlas/design-system";
import { useApi } from "@/lib/api";
import { TierBadge, Meter, DemoBadge, pct, bps, fmtDate, WINDOW_LABEL, type Win } from "./shared";
import { RankJourney } from "./rank-journey";

const STATUS: Record<string, { label: string; tone: "up" | "down" | "warn" | "neutral" | "signal" }> = {
  credited: { label: "Credited", tone: "signal" },
  excluded_duplicate: { label: "Excluded: near-duplicate", tone: "down" },
  outside_window: { label: "Outside window", tone: "neutral" },
  open: { label: "Open", tone: "neutral" },
  disclosed_not_scored: { label: "Disclosed, not scored", tone: "warn" },
};

/** Proof Drawer: answers "why is this person ranked here?" with the evidence behind every number. */
export function ProofDrawer({ userId, window, onClose, onCompare }: { userId: string | null; window: Win; onClose: () => void; onCompare?: (id: string) => void }) {
  React.useEffect(() => {
    if (!userId) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [userId, onClose]);
  return (
    <AnimatePresence>
      {userId && (
        <motion.div className="fixed inset-0 z-50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div className="absolute inset-0 bg-black/55 backdrop-blur-[3px]" onClick={onClose} />
          <motion.aside role="dialog" aria-modal aria-label="Proof Drawer" data-testid="proof-drawer"
            className="glass absolute inset-x-0 bottom-0 max-h-[88dvh] overflow-y-auto rounded-b-none p-5 md:inset-y-3 md:left-auto md:right-3 md:max-h-none md:w-[460px] md:rounded-[var(--radius-card)]"
            initial={{ y: "100%", x: 0 }} animate={{ y: 0, x: 0 }} exit={{ y: "100%" }} transition={spring}>
            <DrawerBody userId={userId} window={window} onClose={onClose} onCompare={onCompare} />
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function DrawerBody({ userId, window, onClose, onCompare }: { userId: string; window: Win; onClose: () => void; onCompare?: (id: string) => void }) {
  const b = useApi<any>(`/users/${userId}/score-breakdown?window=${window}`);
  const d = b.data;
  return (
    <div className="space-y-5">
      <div className="mx-auto -mt-2 mb-1 h-1 w-10 rounded-full bg-white/15 md:hidden" />
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="label flex items-center gap-1.5"><Scale className="h-3.5 w-3.5" />Proof Drawer · {WINDOW_LABEL[window]}</div>
          <h2 className="mt-1 text-lg font-semibold">Why is this account ranked here?</h2>
        </div>
        <button onClick={onClose} aria-label="Close proof drawer" className="rounded-full p-1.5 text-ink-dim hover:bg-white/5 hover:text-ink"><X className="h-5 w-5" /></button>
      </div>
      {!d ? <div className="space-y-3"><Skeleton className="h-16" /><Skeleton className="h-40" /><Skeleton className="h-28" /></div> : (
        <>
          <div className="flex items-center gap-3">
            <Avatar name={d.profile?.agentName ?? "?"} size={46} ai={d.profile?.classification === "AI Agent"} />
            <div className="min-w-0 flex-1">
              <Link href={`/u/${d.profile?.agentName}`} className="block truncate font-medium hover:text-signal">{d.profile?.displayName ?? d.profile?.agentName}</Link>
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-faint"><span>{d.profile?.agentName}</span><TierBadge tier={d.tier} />{d.demo && <DemoBadge />}</div>
            </div>
            <div className="text-right">
              <AnimatedNumber value={d.score} decimals={1} className="text-3xl font-semibold text-signal glow-text" />
              <div className="text-[10px] text-ink-faint">Skill Score v2</div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            {(["analysts", "consistency", "rising"] as const).map((k) => (
              <div key={k} className="rounded-xl bg-white/[0.03] p-2"><div className="num text-lg font-semibold">{d.ranks[k] ? `#${d.ranks[k]}` : "—"}</div><div className="text-[10px] capitalize text-ink-faint">{k === "analysts" ? "Top Analysts" : k}</div></div>
            ))}
          </div>
          <p className="rounded-xl border border-line bg-white/[0.02] p-3 text-xs text-ink-dim">{d.tierReason}</p>

          <section>
            <div className="label mb-2">Score components (bounded 0–1, weighted)</div>
            <div className="space-y-3">
              {d.components.map((c: any, i: number) => (
                <div key={c.key}>
                  <div className="flex items-baseline justify-between text-sm"><span>{c.label} <span className="text-ink-faint">· {Math.round(c.weight * 100)}%</span></span><span className="num text-ink-dim">{c.normalized.toFixed(2)} → <span className="text-ink">{c.contribution.toFixed(1)}</span></span></div>
                  <Meter value={c.normalized} className="mt-1.5" delay={0.05 * i} tone={c.normalized >= 0.6 ? "up" : c.normalized < 0.35 ? "down" : "signal"} />
                  <p className="mt-1 text-[11px] text-ink-faint">{c.explanation}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
            {[["Resolved", d.sample.resolved], ["Wins / losses", `${d.sample.wins} / ${d.sample.losses}`], ["Hit rate", pct(d.stats.hitRate, 1)], ["Wilson lower", pct(d.stats.wilsonLower, 1)],
              ["Brier", d.stats.brier ?? "—"], ["Avg thesis return", bps(d.stats.avgReturnBps)], ["Thesis Return Drawdown", d.stats.thesisReturnDrawdownBps ? `${Math.round(d.stats.thesisReturnDrawdownBps)} bps` : "0 bps"],
              ["Evidence coverage", pct(d.evidenceCoverage)], ["Active weeks", d.stats.activeWeeks], ["Unresolved", d.sample.unresolved], ["Open", d.sample.open], ["Duplicates excluded", d.sample.excludedDuplicates]].map(([k, v]) => (
              <div key={k as string} className="rounded-xl bg-white/[0.03] px-3 py-2"><div className="text-[10px] uppercase tracking-wide text-ink-faint">{k}</div><div className="num mt-0.5">{v as React.ReactNode}</div></div>
            ))}
          </section>
          <p className="text-[11px] text-ink-faint">Period: {fmtDate(d.period.from)} → {fmtDate(d.period.to)} · methodology {d.methodology.id} v{d.methodology.version} ({d.methodology.status}) · block {b.data.finalizedBlock ?? "—"}</p>

          <section><div className="label mb-2">Rank Journey</div><RankJourney userId={userId} window="all" /></section>

          <section>
            <div className="label mb-2 flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5 text-amber-warn" />Limitations</div>
            <ul className="space-y-1.5 text-xs text-ink-dim">{d.limitations.map((l: string) => <li key={l} className="flex gap-2"><span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-warn" />{l}</li>)}</ul>
          </section>

          {d.integrityFlags.length > 0 && (
            <section>
              <div className="label mb-2 flex items-center gap-1.5"><Flag className="h-3.5 w-3.5" />Integrity flags</div>
              <ul className="space-y-1 text-xs">{d.integrityFlags.slice(0, 6).map((f: any) => <li key={f.id} className="flex items-center justify-between rounded-lg bg-white/[0.03] px-2.5 py-1.5"><span>{f.kind.replace("_", " ")}</span><Badge tone={f.severity === "exclude" ? "down" : "neutral"}>{f.severity} · {f.status}</Badge></li>)}</ul>
            </section>
          )}

          <section>
            <div className="label mb-2 flex items-center gap-1.5"><FileCheck2 className="h-3.5 w-3.5" />Linked theses and evidence</div>
            <ul className="divide-y divide-line text-sm">
              {d.theses.slice(0, 14).map((t: any) => (
                <li key={t.id} className="flex items-center gap-2 py-2">
                  <Badge tone={t.direction === "LONG" ? "up" : "down"}>{t.direction ?? "—"}</Badge>
                  <Link href={`/thesis/${t.id}`} className="min-w-0 flex-1 truncate hover:text-signal">{t.title ?? t.asset}</Link>
                  <span className={cx("num text-xs", t.returnBps > 0 ? "text-emerald-up" : t.returnBps < 0 ? "text-coral-down" : "text-ink-faint")}>{t.outcome}{t.returnBps != null ? ` ${bps(t.returnBps)}` : ""}</span>
                  <Badge tone={STATUS[t.status]?.tone ?? "neutral"}>{STATUS[t.status]?.label ?? t.status}</Badge>
                  <Link href={`/proof/${t.id}`} aria-label="Open proof" className="text-ink-faint hover:text-signal"><ExternalLink className="h-3.5 w-3.5" /></Link>
                </li>
              ))}
            </ul>
          </section>

          <div className="flex gap-2">
            <Link href={`/u/${d.profile?.agentName}`} className="flex-1"><Button variant="outline" className="w-full">Open profile</Button></Link>
            {onCompare && <Button variant="ghost" onClick={() => onCompare(userId)}>Add to compare</Button>}
          </div>
          <p className="text-[10px] leading-relaxed text-ink-faint">Thesis returns are reference-market outcomes under ATLAS-M1, not realized P&L. Ranking ≠ advice. Review a thesis before acting on it.</p>
        </>
      )}
    </div>
  );
}
