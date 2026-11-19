"use client";
import Link from "next/link";
import { AlertTriangle, Hash } from "lucide-react";
import { AnimatedNumber, Card, Skeleton, Sparkline, StaggerItem, StaggerList, cx } from "@atlas/design-system";
import { useApi } from "@/lib/api";

export function RightPanel() {
  const m = useApi<any>("/markets", { refreshInterval: 20_000 });
  const ex = useApi<any>("/explore?q=");
  return (
    <div className="space-y-4">
      <Card className="p-4" hover={false}>
        <div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-semibold">Markets</h3><span className="text-[10px] text-ink-faint">{m.data?.simulated ? "SIMULATED" : `${m.data?.source === "okx-public" ? "OKX" : "Binance spot"} · reference`}</span></div>
        {!m.data ? <div className="space-y-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-9" />)}</div> : (
          <StaggerList className="space-y-1">
            {m.data.items.filter((x: any) => x.asset !== "USDC" && x.ticker).map((x: any) => {
              const ch = x.ticker?.priceChangePercent ?? 0;
              return (
                <StaggerItem key={x.asset}>
                  <Link href={`/markets/${x.asset}`} className="flex items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-white/[0.04]">
                    <span className="w-12 text-sm font-semibold">{x.asset}</span>
                    <Sparkline data={x.sparkline} width={70} height={24} />
                    <span className="ml-auto text-right">
                      <AnimatedNumber value={x.ticker?.lastPrice ?? 0} decimals={x.ticker?.lastPrice > 100 ? 2 : 4} className="block text-sm" />
                      <span className={cx("num block text-[11px]", ch >= 0 ? "text-emerald-up" : "text-coral-down")}>{ch >= 0 ? "+" : ""}{ch.toFixed(2)}%</span>
                    </span>
                  </Link>
                </StaggerItem>
              );
            })}
          </StaggerList>
        )}
      </Card>
      <Card className="p-4" hover={false} data-testid="trending-topics">
        <h3 className="mb-3 text-sm font-semibold">Trending topics</h3>
        {!ex.data ? (
          <div className="flex flex-wrap gap-1.5" aria-busy="true">{["w-14", "w-11", "w-16", "w-10", "w-12"].map((w) => <Skeleton key={w} className={`h-6 rounded-full ${w}`} />)}</div>
        ) : (ex.data.topics ?? []).length === 0 ? (
          <div data-testid="trending-empty" className="flex items-start gap-2.5 rounded-xl border border-dashed border-line px-3 py-3 text-xs leading-relaxed text-ink-dim">
            <Hash className="mt-0.5 h-3.5 w-3.5 shrink-0 text-signal" />
            <span>Nothing trending yet. Topics appear here when people tag posts and theses with <span className="text-ink">#hashtags</span> like #bnb or #macro.</span>
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {ex.data.topics.slice(0, 12).map((t: any) => <Link key={t.topic} href={`/explore?topic=${t.topic}`} className="rounded-full border border-line px-2.5 py-1 text-xs text-ink-dim hover:border-signal/40 hover:text-ink">#{t.topic} <span className="num text-ink-faint">{t.posts}</span></Link>)}
          </div>
        )}
      </Card>
      <Card className="p-4" hover={false}>
        <h3 className="mb-3 text-sm font-semibold">Creators</h3>
        <div className="space-y-2">
          {!ex.data ? [0, 1, 2].map((i) => <Skeleton key={i} className="h-6" />) : (ex.data.creators ?? []).length === 0 ? <p className="text-xs text-ink-dim">No creators to show yet.</p> : null}
          {(ex.data?.creators ?? []).slice(0, 5).map((c: any) => (
            <Link key={c.userId} href={`/u/${c.agentName}`} className="flex items-center justify-between rounded-lg px-1 py-1 text-sm hover:bg-white/[0.03]">
              <span className="truncate">{c.displayName ?? c.agentName}</span><span className="text-xs text-ink-faint">{c.agentName}</span>
            </Link>
          ))}
        </div>
      </Card>
      <div className="flex gap-2 rounded-2xl border border-amber-warn/15 bg-amber-warn/[0.04] p-3 text-[11px] leading-relaxed text-ink-dim">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-warn" />
        Research, not advice. Digital assets are volatile and you can lose money. ATLAS never holds keys, never signs for you and never promises returns.
      </div>
    </div>
  );
}
