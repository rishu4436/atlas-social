"use client";
import { motion, AnimatePresence } from "motion/react";
import { GitCompareArrows, X } from "lucide-react";
import { Avatar, Button, Modal, Skeleton, cx } from "@atlas/design-system";
import { useApi } from "@/lib/api";
import { TierBadge, pct, WINDOW_LABEL, type Win } from "./shared";

export function CompareBar({ ids, onOpen, onClear }: { ids: string[]; onOpen: () => void; onClear: () => void }) {
  return (
    <AnimatePresence>
      {ids.length > 0 && (
        <motion.div initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 80, opacity: 0 }} className="fixed inset-x-0 bottom-20 z-40 mx-auto flex w-fit items-center gap-3 rounded-full border border-signal/30 bg-obsidian/90 px-4 py-2 shadow-[var(--shadow-glow)] backdrop-blur-xl lg:bottom-6">
          <GitCompareArrows className="h-4 w-4 text-signal" /><span className="text-sm">{ids.length} selected {ids.length < 2 && <span className="text-ink-faint">(pick 2–3)</span>}</span>
          <Button size="sm" disabled={ids.length < 2} onClick={onOpen}>Compare</Button>
          <button onClick={onClear} aria-label="Clear comparison" className="text-ink-faint hover:text-ink"><X className="h-4 w-4" /></button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Trader Comparison Lab: 2–3 traders side by side. Realized P&L stays empty until Arena 2.0 can verify it. */
export function CompareLab({ ids, window, open, onClose }: { ids: string[]; window: Win; open: boolean; onClose: () => void }) {
  const c = useApi<any>(open && ids.length >= 2 ? `/traders/compare?ids=${ids.join(",")}&window=${window}` : null);
  const rows: [string, (t: any) => number | null, (t: any) => string, "high" | "low"][] = [
    ["Skill score", (t) => t.skillScore, (t) => t.skillScore.toFixed(1), "high"],
    ["Resolved predictions", (t) => t.resolved, (t) => String(t.resolved), "high"],
    ["Hit rate", (t) => t.hitRate, (t) => pct(t.hitRate, 1), "high"],
    ["Calibration (Brier)", (t) => t.calibrationBrier, (t) => String(t.calibrationBrier ?? "—"), "low"],
    ["Thesis Return Drawdown", (t) => t.thesisReturnDrawdownBps, (t) => `${Math.round(t.thesisReturnDrawdownBps)} bps`, "low"],
    ["Evidence coverage", (t) => t.evidenceCoverage, (t) => pct(t.evidenceCoverage), "high"],
    ["Active weeks", (t) => t.activeWeeks, (t) => String(t.activeWeeks), "high"],
    ["Verified trades", (t) => t.verifiedTrades, (t) => String(t.verifiedTrades), "high"],
  ];
  return (
    <Modal open={open} onClose={onClose} title={`Trader Comparison Lab · ${WINDOW_LABEL[window]}`}>
      {!c.data ? <Skeleton className="h-64" /> : (
        <div className="space-y-3" data-testid="compare-lab">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><th />{c.data.traders.map((t: any) => <th key={t.userId} className="px-2 pb-3 text-left font-normal"><div className="flex items-center gap-2"><Avatar name={t.profile?.agentName ?? "?"} size={28} /><div className="min-w-0"><div className="truncate text-xs font-medium">{t.profile?.displayName}</div><TierBadge tier={t.tier} /></div></div></th>)}</tr></thead>
              <tbody>
                {rows.map(([label, get, fmt, better]) => {
                  const vals = c.data.traders.map(get).filter((v: any) => v != null) as number[];
                  const best = vals.length ? (better === "high" ? Math.max(...vals) : Math.min(...vals)) : null;
                  return <tr key={label} className="border-t border-line"><td className="py-2 pr-2 text-ink-dim">{label}</td>{c.data.traders.map((t: any) => <td key={t.userId} className={cx("num px-2 py-2", get(t) === best && c.data.traders.length > 1 && "font-semibold text-signal")}>{fmt(t)}</td>)}</tr>;
                })}
                <tr className="border-t border-line"><td className="py-2 pr-2 text-ink-dim">Realized trading P&L</td>{c.data.traders.map((t: any) => <td key={t.userId} className="px-2 py-2 text-xs text-ink-faint">Arena 2.0</td>)}</tr>
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-ink-faint">Highlighted = best in row. Methodology {c.data.methodology.id} ({c.data.methodology.status}). Thesis metrics are reference-market outcomes, not realized P&L.</p>
        </div>
      )}
    </Modal>
  );
}
