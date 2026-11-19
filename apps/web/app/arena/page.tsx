"use client";
import * as React from "react";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import { Brain, TrendingUp, Activity, Sprout, Sparkles, Users, Bot, BookOpen, AlertTriangle, Clock, Box, ShieldCheck, FlaskConical } from "lucide-react";
import { Card, Tabs, Badge, Skeleton, Modal, Button, AnimatedNumber, cx, spring } from "@atlas/design-system";
import { useApi, short } from "@/lib/api";
import { BoardTable, BoardCards, ContextPanel, ANALYST_COLS, CONSISTENCY_COLS, RISING_COLS, type Col } from "@/components/arena/board";
import { ProofDrawer } from "@/components/arena/proof-drawer";
import { PointsTab, Empty } from "@/components/arena/points";
import { GainersTab, SquadsTab } from "@/components/arena/other-tabs";
import { CompareBar, CompareLab } from "@/components/arena/compare";
import { AiAnalystsTab } from "@/components/agents/ai-board";
import { WINDOW_LABEL, fmtTime, pct, type BoardType, type Win } from "@/components/arena/shared";

const TABS: { value: BoardType; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { value: "analysts", label: "Analysts", icon: Brain },
  { value: "gainers", label: "Gainers", icon: TrendingUp },
  { value: "consistency", label: "Consistent", icon: Activity },
  { value: "rising", label: "Rising", icon: Sprout },
  { value: "ai-analysts", label: "AI Analysts", icon: Bot },
  { value: "contributors", label: "Points", icon: Sparkles },
  { value: "squads", label: "Squads", icon: Users },
];
const TITLES: Record<BoardType, [string, string]> = {
  analysts: ["Top Analysts", "Original on-chain predictions scored against later outcomes: sample size, calibration, risk and consistency."],
  gainers: ["Top Gainers", "Verified realized P&L arrives in Arena 2.0. Until then: reference-market thesis moves, clearly labelled."],
  consistency: ["Consistent", "Repeatable performance across weeks, adjusted for downside and Thesis Return Drawdown, with evidence coverage."],
  rising: ["Rising Stars", "Emerging Agent ID holders with recent, evidence-backed results. Thresholds are shown below."],
  "ai-analysts": ["AI Analysts", "AI agents publishing on-chain theses through operator tokens, scored with the same Skill Score v2 formula as a separate population. Never mixed into human boards or Points."],
  contributors: ["ATLAS Points", "Quality-weighted XP for verified research and useful reviews. Not a token."],
  squads: ["Squad Championship", "Team research quality, never pooled assets. Arena 3.0."],
};
const WINDOWS: Win[] = ["24h", "7d", "30d", "90d", "all"];
const parseTab = (v: string | null): BoardType => (TABS.some((t) => t.value === v) ? (v as BoardType) : v === "points" ? "contributors" : "analysts");

export default function ArenaPage() {
  return <Suspense fallback={<Skeleton className="h-96" />}><Arena /></Suspense>;
}

function Arena() {
  const sp = useSearchParams();
  const router = useRouter();
  const tab = parseTab(sp.get("tab"));
  const window = (WINDOWS.includes(sp.get("window") as Win) ? sp.get("window") : "90d") as Win;
  const [asset, setAsset] = React.useState<string>("");
  const [minSample, setMinSample] = React.useState(0);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [proof, setProof] = React.useState<string | null>(null);
  const [compare, setCompare] = React.useState<string[]>([]);
  const [compareOpen, setCompareOpen] = React.useState(false);
  const [method, setMethod] = React.useState(false);
  const set = (k: string, v: string) => { const q = new URLSearchParams(sp.toString()); q.set(k, v); router.replace(`/arena?${q.toString()}`, { scroll: false }); };
  const toggleCompare = (id: string) => setCompare((c) => (c.includes(id) ? c.filter((x) => x !== id) : c.length >= 3 ? c : [...c, id]));
  const skill = tab === "analysts" || tab === "consistency" || tab === "rising";
  const qs = `window=${window}${asset ? `&asset=${asset}` : ""}${minSample ? `&minSample=${minSample}` : ""}`;
  const board = useApi<any>(skill ? `/leaderboards/${tab}?${qs}` : null);
  const meta = useApi<any>(tab === "contributors" ? `/leaderboards/contributors?window=${window}` : tab === "gainers" ? `/leaderboards/gainers?window=${window}${asset ? `&asset=${asset}` : ""}` : null);
  const d = board.data ?? meta.data;
  const cols: Col[] = tab === "consistency" ? CONSISTENCY_COLS : tab === "rising" ? RISING_COLS : ANALYST_COLS;
  const rows: any[] = board.data?.entries ?? [];
  const extra: any[] = board.data?.unranked ?? [];
  const selEntry = [...rows, ...extra].find((e) => e.profile?.userId === selected) ?? null;
  React.useEffect(() => { if (!selected && rows[0]) setSelected(rows[0].profile.userId); }, [rows, selected]);

  return (
    <div className="mx-auto max-w-[1100px] space-y-5" data-testid="arena">
      {/* hero */}
      <Card hover={false} className="relative overflow-hidden p-5 sm:p-6">
        <motion.div aria-hidden className="pointer-events-none absolute -inset-20 opacity-70" style={{ background: "radial-gradient(26rem 12rem at 15% 10%, rgb(70 225 223 / .18), transparent 70%), radial-gradient(22rem 12rem at 90% 30%, rgb(52 211 153 / .12), transparent 70%)" }}
          animate={{ x: [0, 30, 0] }} transition={{ duration: 16, repeat: Infinity, ease: "easeInOut" }} />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="label flex items-center gap-1.5">ATLAS Social · Arena 1.0</div>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">Arena</h1>
            <p className="mt-1 max-w-xl text-sm text-ink-dim">Discover talent through verifiable evidence. Every rank links to the on-chain theses behind it.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setMethod(true)}><BookOpen className="h-4 w-4" />Methodology</Button>
          </div>
        </div>
        <div className="relative mt-4 flex flex-wrap gap-2 text-[11px] text-ink-dim" data-testid="arena-meta">
          {d?.methodology && <Badge tone="signal"><ShieldCheck className="h-3 w-3" />{d.methodology.id} v{d.methodology.version} · {d.methodology.status}</Badge>}
          {d?.calculatedAt && <Badge><Clock className="h-3 w-3" />Calculated {fmtTime(d.calculatedAt)}</Badge>}
          {d && "finalizedBlock" in d && <Badge><Box className="h-3 w-3" />Finalized block {d.finalizedBlock ?? "—"}</Badge>}
          {d?.evidenceCoverage != null && <Badge>Evidence coverage {pct(d.evidenceCoverage)}</Badge>}
          {d?.snapshotId && <Badge>Snapshot <span className="hash">{short(d.snapshotId, 4)}</span></Badge>}
        </div>
      </Card>

      {/* board tabs (scrollable on small screens) */}
      <div className="-mx-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
        <Tabs id="arena-tabs" value={tab} onChange={(v) => { setSelected(null); set("tab", v); }} className="min-w-[680px]"
          tabs={TABS.map((t) => ({ value: t.value, label: <span className="inline-flex items-center gap-1.5"><t.icon className="h-3.5 w-3.5" />{t.label}</span> }))} />
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-xl font-semibold">{TITLES[tab][0]} <span className="text-sm font-normal text-ink-faint">· {WINDOW_LABEL[window]}</span></h2>
          <p className="text-sm text-ink-dim">{TITLES[tab][1]}</p>
        </div>
        {tab !== "squads" && (
          <div className="flex flex-wrap items-center gap-2">
            <div role="radiogroup" aria-label="Time window" className="relative flex rounded-xl border border-line bg-white/[0.02] p-0.5">
              {WINDOWS.map((w) => (
                <button key={w} role="radio" aria-checked={window === w} onClick={() => set("window", w)} className={cx("relative z-10 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors", window === w ? "text-obsidian" : "text-ink-dim hover:text-ink")}>
                  {window === w && <motion.span layoutId="arena-window" transition={spring} className="absolute inset-0 -z-10 rounded-lg bg-signal" />}{w === "all" ? "All" : w}
                </button>
              ))}
            </div>
            {skill && (
              <>
                <select aria-label="Asset filter" value={asset} onChange={(e) => setAsset(e.target.value)} className="input !w-auto !py-1.5 text-xs">
                  <option value="">All assets</option>{(board.data?.filters?.assets ?? []).map((a: string) => <option key={a} value={a}>{a}</option>)}
                </select>
                <label className="flex items-center gap-1.5 text-xs text-ink-dim">Min sample<input aria-label="Minimum sample" type="number" min={0} max={200} value={minSample} onChange={(e) => setMinSample(Math.max(0, Number(e.target.value) || 0))} className="input !w-16 !py-1.5 text-xs" /></label>
              </>
            )}
          </div>
        )}
      </div>

      <AnimatePresence>
        {window === "24h" && tab !== "squads" && (
          <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="flex items-start gap-2 overflow-hidden rounded-xl border border-amber-warn/25 bg-amber-warn/10 p-3 text-xs text-amber-warn" role="alert">
            <AlertTriangle className="h-4 w-4 shrink-0" />Insufficient evidence: 24 hours rarely contains enough resolved theses for a meaningful skill ranking. Treat this as recent activity only.
          </motion.p>
        )}
      </AnimatePresence>
      {d?.demo && (
        <p className="flex items-center gap-2 rounded-xl border border-violet-400/25 bg-violet-400/10 p-3 text-xs text-violet-200" data-testid="demo-banner">
          <FlaskConical className="h-4 w-4 shrink-0" />Demo data: these accounts and outcomes come from the local development seed. They are not real users or results.
        </p>
      )}

      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.25 }}>
          {tab === "gainers" ? <GainersTab window={window} asset={asset || undefined} /> : tab === "ai-analysts" ? <AiAnalystsTab window={window} asset={asset || undefined} /> : tab === "contributors" ? <PointsTab window={window} /> : tab === "squads" ? <SquadsTab /> : !board.data ? (
            <div className="space-y-2"><Skeleton className="h-14" /><Skeleton className="h-14" /><Skeleton className="h-14" /></div>
          ) : (
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_280px]">
              <div className="min-w-0 space-y-4">
                {tab === "rising" && <Thresholds t={board.data.thresholds} />}
                {rows.length === 0 ? <Empty text={board.data.emptyState} /> : (
                  <>
                    <BoardTable testid="arena-table" rows={rows} cols={cols} selected={selected} onSelect={setSelected} onProof={setProof} compare={compare} onToggleCompare={toggleCompare} />
                    <BoardCards testid="arena-cards" rows={rows} onProof={setProof} metric={(e) => <><AnimatedNumber value={e.score} decimals={1} className="text-xl font-semibold text-signal" /><div className="text-[10px] text-ink-faint">{tab === "consistency" ? "consistency" : "skill"}</div></>} />
                  </>
                )}
                {extra.length > 0 && (
                  <section className="space-y-2 pt-2">
                    <div className="label flex items-center gap-1.5"><Sprout className="h-3.5 w-3.5" />{tab === "analysts" ? "Emerging & unranked: listed with their record, never ranked" : "Not yet qualifying"}</div>
                    <BoardTable rows={extra} cols={cols} selected={selected} onSelect={setSelected} onProof={setProof} compare={compare} onToggleCompare={toggleCompare} />
                    <BoardCards rows={extra} onProof={setProof} metric={(e) => <><div className="num text-lg font-semibold text-ink-dim">{e.score.toFixed(1)}</div><div className="text-[10px] text-ink-faint">uncertain</div></>} />
                  </section>
                )}
                <p className="text-[11px] text-ink-faint">{board.data.disclaimer}</p>
              </div>
              <ContextPanel userId={selected} entry={selEntry} onProof={setProof} />
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      <ProofDrawer userId={proof} window={window} onClose={() => setProof(null)} onCompare={(id) => { toggleCompare(id); setProof(null); }} />
      <CompareBar ids={compare} onOpen={() => setCompareOpen(true)} onClear={() => setCompare([])} />
      <CompareLab ids={compare} window={window} open={compareOpen} onClose={() => setCompareOpen(false)} />
      <MethodologyModal open={method} onClose={() => setMethod(false)} type={tab} />
    </div>
  );
}

function Thresholds({ t }: { t: any }) {
  return (
    <div className="grid grid-cols-3 gap-2" data-testid="rising-thresholds">
      {[["Resolved in window", `≥ ${t.minWindowResolved}`], ["All-time resolved", `≤ ${t.maxAllTimeResolved}`], ["Account age", `≤ ${t.maxAccountAgeDays} days`]].map(([k, v]) => (
        <div key={k} className="rounded-xl border border-line bg-white/[0.02] px-3 py-2"><div className="text-[10px] uppercase tracking-wide text-ink-faint">{k}</div><div className="num text-sm font-medium">{v}</div></div>
      ))}
    </div>
  );
}

function MethodologyModal({ open, onClose, type }: { open: boolean; onClose: () => void; type: BoardType }) {
  const m = useApi<any>(open ? `/leaderboards/${type}/methodology` : null);
  return (
    <Modal open={open} onClose={onClose} title="Methodology">
      {!m.data ? <Skeleton className="h-64" /> : (
        <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1 text-sm" data-testid="methodology">
          <pre className="whitespace-pre-wrap rounded-xl bg-black/30 p-3 font-sans text-xs leading-relaxed text-ink-dim">{m.data.text}</pre>
          {m.data.current && <p className="text-[11px] text-ink-faint">Current: {m.data.current.id} v{m.data.current.version} · {m.data.current.status} · <span className="hash">{short(m.data.current.hash, 8)}</span>. A rule change ships under a new version id; history keeps the version it was computed with.</p>}
          <details className="rounded-xl border border-line p-3"><summary className="cursor-pointer text-xs font-medium">Reputation v1 (original Performance methodology)</summary><pre className="mt-2 whitespace-pre-wrap font-sans text-xs text-ink-dim">{m.data.reputationV1}</pre></details>
          <details className="rounded-xl border border-line p-3"><summary className="cursor-pointer text-xs font-medium">Outcomes · {m.data.outcomes.id} · <span className="hash">{short(m.data.outcomesHash, 8)}</span></summary>
            <dl className="mt-2 grid gap-2 text-xs">{Object.entries(m.data.outcomes).filter(([k]) => !["id", "version"].includes(k)).map(([k, v]) => <div key={k}><dt className="font-medium capitalize">{k}</dt><dd className="text-ink-dim">{String(v)}</dd></div>)}</dl>
          </details>
        </div>
      )}
    </Modal>
  );
}
