"use client";
import Link from "next/link";
import { Card, Skeleton, Sparkline, AnimatedNumber, PriceFlash, StaggerList, StaggerItem, Badge, cx } from "@atlas/design-system";
import { useApi } from "@/lib/api";
import { RiskWarning } from "@/components/risk";

export default function Markets() {
  const m = useApi<any>("/markets", { refreshInterval: 15_000 });
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex items-end justify-between"><div><h1 className="text-2xl font-semibold">Markets</h1><p className="text-sm text-ink-dim">Allowlisted BSC tokens. Reference prices from public exchange APIs{m.data ? ` (${m.data.source === "okx-public" ? "OKX" : "Binance spot"})` : ""}.</p></div>{m.data && <Badge tone={m.data.simulated ? "warn" : "up"}>{m.data.simulated ? "Simulated data" : "Live"}</Badge>}</div>
      {!m.data ? <div className="grid gap-3 sm:grid-cols-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-36" />)}</div> : (
        <StaggerList className="grid gap-3 sm:grid-cols-2">
          {m.data.items.filter((x: any) => x.ticker).map((x: any) => { const up = x.ticker.priceChangePercent >= 0; const dp = x.ticker.lastPrice > 100 ? 2 : 4; return (
            <StaggerItem key={x.asset}><Link href={`/markets/${x.asset}`}><Card className="p-5">
              <div className="flex items-center justify-between"><div><div className="text-lg font-semibold">{x.asset}</div><div className="text-xs text-ink-faint">{x.symbol}</div></div><Sparkline data={x.sparkline} up={up} width={140} height={44} /></div>
              <div className="mt-4 flex items-end justify-between">
                <PriceFlash value={x.ticker.lastPrice}><AnimatedNumber value={x.ticker.lastPrice} decimals={dp} className="text-2xl font-semibold" /></PriceFlash>
                <span className={cx("num text-sm font-medium", up ? "text-emerald-up" : "text-coral-down")}>{up ? "+" : ""}<AnimatedNumber value={x.ticker.priceChangePercent} decimals={2} />%</span>
              </div>
              <div className="mt-2 flex gap-4 text-[11px] text-ink-faint"><span>H <span className="num">{x.ticker.highPrice}</span></span><span>L <span className="num">{x.ticker.lowPrice}</span></span><span>Vol $<span className="num">{(x.ticker.quoteVolume / 1e6).toFixed(1)}M</span></span></div>
            </Card></Link></StaggerItem>); })}
        </StaggerList>
      )}
      <RiskWarning />
    </div>
  );
}
