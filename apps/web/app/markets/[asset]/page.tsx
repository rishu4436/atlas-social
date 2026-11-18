"use client";
import { use, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "motion/react";
import { Sparkles, ArrowRightLeft, PenSquare, CandlestickChart, LineChart } from "lucide-react";
import { Card, Button, Badge, Tabs, Skeleton, AnimatedNumber, PriceFlash, StaggerList, StaggerItem, cx } from "@atlas/design-system";
import { api, useApi, useSession, timeAgo } from "@/lib/api";
import { PriceChart } from "@/components/chart";
import { RiskWarning } from "@/components/risk";
import { useToast } from "@/components/providers";

export default function Market({ params }: { params: Promise<{ asset: string }> }) {
  const { asset } = use(params);
  const A = asset.toUpperCase();
  const { authed } = useSession();
  const toast = useToast();
  const [iv, setIv] = useState<"15m" | "1h" | "4h" | "1d">("1h");
  const [mode, setMode] = useState<"area" | "candles">("area");
  const m = useApi<any>(`/markets/${A}`, { refreshInterval: 10_000 });
  const h = useApi<any>(`/markets/${A}/history?interval=${iv}&limit=200`, { keepPreviousData: true });
  const [ai, setAi] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  if (m.error) return <Card className="p-10 text-center text-ink-dim">Unknown market.</Card>;
  const tk = m.data?.ticker; const up = (tk?.priceChangePercent ?? 0) >= 0; const dp = (tk?.lastPrice ?? 0) > 100 ? 2 : 4;
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <Card hover={false} className="space-y-4 p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-2"><h1 className="text-2xl font-semibold">{A}</h1><span className="text-sm text-ink-faint">{m.data?.symbol}</span>{m.data && <Badge tone={m.data.simulated ? "warn" : "up"}>{m.data.simulated ? "Simulated" : "Live"}</Badge>}</div>
            {tk ? <div className="mt-1 flex items-baseline gap-3"><PriceFlash value={tk.lastPrice}><AnimatedNumber value={tk.lastPrice} decimals={dp} className="text-4xl font-semibold tracking-tight" /></PriceFlash><span className={cx("num", up ? "text-emerald-up" : "text-coral-down")}>{up ? "+" : ""}{tk.priceChangePercent.toFixed(2)}%</span></div> : <Skeleton className="mt-2 h-10 w-48" />}
          </div>
          <div className="flex gap-2">
            <Tabs id="iv" value={iv} onChange={setIv} tabs={(["15m", "1h", "4h", "1d"] as const).map((v) => ({ value: v, label: v }))} />
            <motion.button whileTap={{ scale: 0.9 }} aria-label="Toggle chart type" onClick={() => setMode(mode === "area" ? "candles" : "area")} className="grid h-11 w-11 place-items-center rounded-2xl border border-line text-ink-dim hover:text-ink">{mode === "area" ? <CandlestickChart className="h-4 w-4" /> : <LineChart className="h-4 w-4" />}</motion.button>
          </div>
        </div>
        {h.data ? <PriceChart candles={h.data.candles} mode={mode} height={340} /> : <Skeleton className="h-[340px]" />}
        <div className="flex flex-wrap gap-2">
          <Link href={`/trade/${A}`}><Button><ArrowRightLeft className="h-4 w-4" />Prepare a swap</Button></Link>
          {authed && <Link href="/compose"><Button variant="outline"><PenSquare className="h-4 w-4" />Publish a thesis</Button></Link>}
          <Button variant="ghost" loading={busy} onClick={async () => { setBusy(true); try { setAi(await api("/research/analyze", { body: { asset: A } })); } catch (e: any) { toast({ kind: "err", text: e.message }); } finally { setBusy(false); } }}><Sparkles className="h-4 w-4" />AI brief</Button>
        </div>
      </Card>
      <AnimatePresence>{ai && (
        <Card hover={false} className="space-y-3 p-5" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <div className="flex items-center justify-between"><Badge tone="ai"><Sparkles className="h-3 w-3" />{ai.brief.title}</Badge><span className="num text-xs text-ink-faint">confidence {ai.brief.confidence}</span></div>
          <p className="text-sm">{ai.brief.summary}</p>
          <ul className="grid gap-1.5 text-sm sm:grid-cols-2">{ai.brief.findings.map((f: any, i: number) => <li key={i} className="rounded-xl bg-black/25 p-3"><b className="font-medium">{f.claim}</b><span className="block text-xs text-ink-faint">{f.evidence}</span></li>)}</ul>
          <p className="text-[11px] text-ink-faint">{ai.brief.disclaimer}</p>
        </Card>
      )}</AnimatePresence>
      <Card hover={false} className="p-5">
        <div className="label mb-3">Recent theses on {A}</div>
        {!m.data ? <Skeleton className="h-20" /> : m.data.theses.length === 0 ? <p className="text-sm text-ink-dim">None yet.</p> : (
          <StaggerList className="divide-y divide-line">{m.data.theses.map((t: any) => (
            <StaggerItem key={t.id}><Link href={`/thesis/${t.id}`} className="flex items-center justify-between py-3 text-sm hover:text-signal">
              <span><Badge tone={t.direction === "LONG" ? "up" : "down"}>{t.direction}</Badge> <span className="ml-2">{t.agent_name}</span></span>
              <span className="num text-ink-dim">T {t.target_price} · I {t.invalidation_price} · <span className="text-ink-faint">{t.outcome} · {timeAgo(t.created_at)}</span></span>
            </Link></StaggerItem>
          ))}</StaggerList>
        )}
      </Card>
      <RiskWarning text={m.data?.riskWarning} />
    </div>
  );
}
