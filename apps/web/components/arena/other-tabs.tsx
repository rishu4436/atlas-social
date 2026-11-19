"use client";
import Link from "next/link";
import { motion } from "motion/react";
import { Lock, TrendingUp, Users, CheckCircle2 } from "lucide-react";
import { Card, Avatar, Badge, Skeleton } from "@atlas/design-system";
import { useApi } from "@/lib/api";
import { DemoBadge, bps, fmtDate } from "./shared";
import { Empty } from "./points";

export function GainersTab({ window, asset }: { window: string; asset?: string }) {
  const g = useApi<any>(`/leaderboards/gainers?window=${window}${asset ? `&asset=${asset}` : ""}`);
  if (!g.data) return <Skeleton className="h-72" />;
  const reqs = ["Verified Agent ID account", "Explicit consent to publish performance", "Verified, attributable transaction history", "Known cost basis and disposal", "Fees and gas accounted for", "Minimum qualifying activity"];
  return (
    <div className="space-y-5" data-testid="gainers-tab">
      <Card hover={false} className="relative overflow-hidden p-6">
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-emerald-up/10 blur-3xl" />
        <div className="relative flex flex-col gap-4 md:flex-row md:items-center">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/5"><Lock className="h-6 w-6 text-ink-dim" /></span>
          <div className="flex-1">
            <h3 className="text-lg font-semibold">Verified realized P&L coming in Arena 2.0</h3>
            <p className="mt-1 text-sm text-ink-dim">{g.data.realizedPnl.message}</p>
          </div>
        </div>
        <ul className="relative mt-4 grid gap-1.5 text-xs text-ink-dim sm:grid-cols-2">{reqs.map((r) => <li key={r} className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-ink-faint" />{r}</li>)}</ul>
      </Card>
      <section>
        <div className="mb-2 flex flex-wrap items-center gap-2"><h3 className="font-semibold">Top Thesis Moves</h3><Badge tone="warn">Reference-market outcomes · not money earned</Badge>{g.data.demo && <DemoBadge />}</div>
        <p className="mb-3 text-xs text-ink-faint">{g.data.thesisMoves.note}</p>
        {g.data.thesisMoves.items.length === 0 ? <Empty text="Top Thesis Moves will appear once on-chain theses reach their targets in this window. No fictional figures are shown." /> : (
          <motion.ul className="grid gap-2 sm:grid-cols-2" initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: 0.04 } } }}>
            {g.data.thesisMoves.items.map((m: any) => (
              <motion.li key={m.thesisId} variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}>
                <Link href={`/thesis/${m.thesisId}`} className="glass glass-hover flex items-center gap-3 p-3">
                  <Avatar name={m.profile?.agentName ?? "?"} size={32} />
                  <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{m.title ?? m.asset}</div><div className="text-[11px] text-ink-faint">{m.profile?.agentName} · {m.asset} {m.direction} · {fmtDate(m.resolvedAt)}</div></div>
                  <div className="text-right"><div className="num flex items-center gap-1 font-semibold text-emerald-up"><TrendingUp className="h-3.5 w-3.5" />{bps(m.returnBps)}</div><div className="text-[9px] uppercase tracking-wide text-ink-faint">reference move</div></div>
                </Link>
              </motion.li>
            ))}
          </motion.ul>
        )}
      </section>
    </div>
  );
}

export function SquadsTab() {
  const s = useApi<any>("/leaderboards/squads");
  return (
    <Card hover={false} className="relative overflow-hidden p-8 text-center" data-testid="squads-tab">
      <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(24rem 10rem at 50% 0%, rgb(139 92 246 / .16), transparent 70%)" }} />
      <div className="relative mx-auto max-w-lg space-y-3">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-white/5"><Users className="h-6 w-6 text-violet-300" /></span>
        <h3 className="text-lg font-semibold">Squad Championship arrives in Arena 3.0</h3>
        <p className="text-sm text-ink-dim">{s.data?.message ?? "Squads will be ranked by normalized research quality, never by pooled assets or wallet wealth."}</p>
        {s.data && <p className="text-xs text-ink-faint">{s.data.squads} squads are already collaborating. <Link href="/squads" className="text-signal hover:underline">Explore squads</Link></p>}
      </div>
    </Card>
  );
}
