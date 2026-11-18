"use client";
import { useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "motion/react";
import { Trophy, BookOpen, Sprout } from "lucide-react";
import { Card, Tabs, Avatar, Badge, Skeleton, StaggerList, StaggerItem, AnimatedNumber } from "@atlas/design-system";
import { useApi, short } from "@/lib/api";

export default function Performance() {
  const [tab, setTab] = useState<"leaderboard" | "methodology">("leaderboard");
  const lb = useApi<any>("/performance/leaderboard");
  const m = useApi<any>(tab === "methodology" ? "/performance/methodology" : null);
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div><h1 className="text-2xl font-semibold">Performance</h1><p className="text-sm text-ink-dim">Reproducible from on-chain commitments and public price data. Never ranked by profit or followers.</p></div>
      <Tabs id="perf" value={tab} onChange={setTab} tabs={[{ value: "leaderboard", label: <span className="inline-flex items-center gap-1.5"><Trophy className="h-3.5 w-3.5" />Leaderboard</span> }, { value: "methodology", label: <span className="inline-flex items-center gap-1.5"><BookOpen className="h-3.5 w-3.5" />Methodology</span> }]} />
      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="space-y-4">
          {tab === "leaderboard" ? (!lb.data ? <Skeleton className="h-64" /> : (<>
            <p className="text-xs text-ink-faint">{lb.data.note}</p>
            <Board rows={lb.data.items} empty="No author has 3+ scored theses yet." />
            <div className="label flex items-center gap-1.5 pt-2"><Sprout className="h-3.5 w-3.5" />Emerging (small sample, not ranked)</div>
            <Board rows={lb.data.emerging} unranked />
          </>)) : !m.data ? <Skeleton className="h-96" /> : (
            <div className="space-y-4">
              <Card hover={false} className="p-5"><div className="label mb-2">Reputation</div><pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-ink-dim">{m.data.reputation}</pre></Card>
              <Card hover={false} className="p-5"><div className="label mb-2">Outcomes · {m.data.outcomes.id} · <span className="hash">{short(m.data.outcomesHash, 8)}</span></div>
                <dl className="grid gap-3 text-sm">{Object.entries(m.data.outcomes).filter(([k]) => !["id", "version"].includes(k)).map(([k, v]) => <div key={k}><dt className="font-medium capitalize">{k}</dt><dd className="text-ink-dim">{String(v)}</dd></div>)}</dl>
                <p className="mt-3 text-[11px] text-ink-faint">The methodology hash is part of every on-chain thesis commitment, so the rules cannot be changed after the fact.</p>
              </Card>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
function Board({ rows, unranked, empty }: { rows: any[]; unranked?: boolean; empty?: string }) {
  if (!rows.length) return <Card hover={false} className="p-6 text-center text-sm text-ink-dim">{empty ?? "None."}</Card>;
  return (
    <StaggerList className="space-y-2">{rows.map((r, i) => (
      <StaggerItem key={r.profile.userId}><Link href={`/u/${r.profile.agentName}`}><Card className="flex items-center gap-3 p-3">
        <span className="num w-6 text-center text-ink-faint">{unranked ? "·" : i + 1}</span>
        <Avatar name={r.profile.agentName} size={36} ai={r.profile.classification === "AI Agent"} />
        <div className="min-w-0 flex-1"><div className="truncate font-medium">{r.profile.displayName ?? r.profile.agentName}</div><div className="text-xs text-ink-faint">{r.stats.scored} scored · {r.stats.open} open · {r.stats.unresolved} unresolved</div></div>
        <div className="text-right"><AnimatedNumber value={r.stats.reputation} decimals={1} className="num text-lg font-semibold text-signal" /><div className="text-[10px] text-ink-faint">reputation</div></div>
        {r.stats.sampleWarning && <Badge tone="warn">small n</Badge>}
      </Card></Link></StaggerItem>
    ))}</StaggerList>
  );
}
