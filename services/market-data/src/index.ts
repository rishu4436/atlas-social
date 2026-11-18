import { z } from "zod";

export interface Candle {
  openTime: number; // ms
  closeTime: number; // ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number; // base volume
  quoteVolume: number;
}

export interface Ticker24h {
  symbol: string;
  lastPrice: number;
  priceChangePercent: number;
  highPrice: number;
  lowPrice: number;
  volume: number;
  quoteVolume: number;
  closeTime: number;
}

export type Interval = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";
export const INTERVAL_MS: Record<Interval, number> = { "1m": 60e3, "5m": 300e3, "15m": 900e3, "1h": 3600e3, "4h": 14400e3, "1d": 86400e3 };

export interface MarketDataProvider {
  readonly id: string;
  readonly simulated: boolean;
  klines(symbol: string, interval: Interval, opts?: { startTime?: number; endTime?: number; limit?: number }): Promise<Candle[]>;
  ticker24h(symbol: string): Promise<Ticker24h>;
}

const klineRow = z.tuple([z.number(), z.string(), z.string(), z.string(), z.string(), z.string(), z.number(), z.string()]).rest(z.unknown());
const tickerSchema = z.object({
  symbol: z.string(), lastPrice: z.string(), priceChangePercent: z.string(), highPrice: z.string(), lowPrice: z.string(),
  volume: z.string(), quoteVolume: z.string(), closeTime: z.number(),
});

/** Binance Spot public market data (no API key). Documented at https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints */
export class BinancePublicProvider implements MarketDataProvider {
  readonly id = "binance-spot-public";
  readonly simulated = false;
  constructor(
    private hosts: string[] = ["https://api.binance.com", "https://data-api.binance.vision", "https://api1.binance.com"],
    private fetchImpl: typeof fetch = fetch,
    private timeoutMs = 8000,
  ) {}

  private async get(path: string): Promise<unknown> {
    let lastErr: unknown;
    for (const h of this.hosts) {
      try {
        const res = await this.fetchImpl(h + path, { signal: AbortSignal.timeout(this.timeoutMs) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
      } catch (e) {
        lastErr = e;
      }
    }
    throw new MarketDataError(`market data unavailable: ${String(lastErr)}`);
  }

  async klines(symbol: string, interval: Interval, opts: { startTime?: number; endTime?: number; limit?: number } = {}) {
    const q = new URLSearchParams({ symbol, interval, limit: String(Math.min(opts.limit ?? 500, 1000)) });
    if (opts.startTime) q.set("startTime", String(opts.startTime));
    if (opts.endTime) q.set("endTime", String(opts.endTime));
    const raw = z.array(klineRow).parse(await this.get(`/api/v3/klines?${q}`));
    return raw.map((r) => ({ openTime: r[0], open: +r[1], high: +r[2], low: +r[3], close: +r[4], volume: +r[5], closeTime: r[6], quoteVolume: +r[7] }));
  }

  async ticker24h(symbol: string) {
    const t = tickerSchema.parse(await this.get(`/api/v3/ticker/24hr?symbol=${symbol}`));
    return { symbol: t.symbol, lastPrice: +t.lastPrice, priceChangePercent: +t.priceChangePercent, highPrice: +t.highPrice, lowPrice: +t.lowPrice, volume: +t.volume, quoteVolume: +t.quoteVolume, closeTime: t.closeTime };
  }
}

export class MarketDataError extends Error {}

const BASE_PRICES: Record<string, number> = { BNBUSDT: 590, BTCUSDT: 92000, ETHUSDT: 3100, CAKEUSDT: 2.4, USDCUSDT: 1, FDUSDUSDT: 1 };

/** Deterministic seeded PRNG (mulberry32). */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hashStr = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);

/**
 * SIMULATED market data for offline development, tests and demos without network access.
 * Deterministic per (symbol, interval, candle index). Every API response carries `simulated: true`.
 */
export class SyntheticProvider implements MarketDataProvider {
  readonly id = "synthetic-simulated";
  readonly simulated = true;
  constructor(private now: () => number = () => Date.now()) {}

  private candleAt(symbol: string, interval: Interval, index: number): Candle {
    const step = INTERVAL_MS[interval];
    const base = BASE_PRICES[symbol] ?? 100;
    const vol = symbol.startsWith("USDC") || symbol.startsWith("FDUSD") ? 0.0004 : 0.012 * Math.sqrt(step / 3600e3);
    // price is a deterministic function of the index: smooth trend + noise
    const p = (i: number) => base * (1 + 0.08 * Math.sin(i / 97) + 0.04 * Math.sin(i / 23) + vol * (rng(hashStr(symbol) ^ i)() - 0.5) * 4);
    const open = p(index - 1);
    const close = p(index);
    const r = rng(hashStr(symbol + interval) ^ (index * 2654435761));
    const high = Math.max(open, close) * (1 + vol * r());
    const low = Math.min(open, close) * (1 - vol * r());
    const volume = (1000 + 9000 * r()) * (base > 1000 ? 0.01 : 1);
    return { openTime: index * step, closeTime: index * step + step - 1, open, high, low, close, volume, quoteVolume: volume * close };
  }

  async klines(symbol: string, interval: Interval, opts: { startTime?: number; endTime?: number; limit?: number } = {}) {
    const step = INTERVAL_MS[interval];
    const limit = Math.min(opts.limit ?? 500, 1000);
    const lastIdx = Math.floor(Math.min(opts.endTime ?? this.now(), this.now()) / step);
    const firstIdx = opts.startTime !== undefined ? Math.floor(opts.startTime / step) : lastIdx - limit + 1;
    const out: Candle[] = [];
    for (let i = firstIdx; i <= lastIdx && out.length < limit; i++) out.push(this.candleAt(symbol, interval, i));
    return out;
  }

  async ticker24h(symbol: string) {
    const c = await this.klines(symbol, "1h", { limit: 24 });
    const last = c[c.length - 1]!;
    return {
      symbol, lastPrice: last.close, priceChangePercent: ((last.close - c[0]!.open) / c[0]!.open) * 100,
      highPrice: Math.max(...c.map((x) => x.high)), lowPrice: Math.min(...c.map((x) => x.low)),
      volume: c.reduce((s, x) => s + x.volume, 0), quoteVolume: c.reduce((s, x) => s + x.quoteVolume, 0), closeTime: last.closeTime,
    };
  }
}

/** Small TTL cache in front of any provider. */
export class CachedProvider implements MarketDataProvider {
  private cache = new Map<string, { at: number; v: unknown }>();
  constructor(private inner: MarketDataProvider, private ttlMs = 15_000) {}
  get id() { return this.inner.id; }
  get simulated() { return this.inner.simulated; }
  private async memo<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.v as T;
    const v = await fn();
    this.cache.set(key, { at: Date.now(), v });
    return v;
  }
  klines(symbol: string, interval: Interval, opts: { startTime?: number; endTime?: number; limit?: number } = {}) {
    return this.memo(`k:${symbol}:${interval}:${JSON.stringify(opts)}`, () => this.inner.klines(symbol, interval, opts));
  }
  ticker24h(symbol: string) {
    return this.memo(`t:${symbol}`, () => this.inner.ticker24h(symbol));
  }
}

/** Provider that falls back to SIMULATED data only when explicitly allowed (dev). */
export function createProvider(mode: "live" | "synthetic" | "live-with-fallback" = "live"): MarketDataProvider {
  if (mode === "synthetic") return new CachedProvider(new SyntheticProvider());
  const live = new CachedProvider(new BinancePublicProvider());
  if (mode === "live") return live;
  const syn = new SyntheticProvider();
  // DEV convenience: `simulated` reports whether the most recent call had to fall back, so responses can be
  // labelled. Outcome evaluation must always use mode "live" (never this fallback).
  let fellBack = false;
  return {
    id: "binance-with-simulated-fallback",
    get simulated() { return fellBack; },
    async klines(s, i, o) { try { const r = await live.klines(s, i, o); fellBack = false; return r; } catch { fellBack = true; return syn.klines(s, i, o); } },
    async ticker24h(s) { try { const r = await live.ticker24h(s); fellBack = false; return r; } catch { fellBack = true; return syn.ticker24h(s); } },
  };
}

/** Detects gaps/staleness so evaluators can mark outcomes Unresolved instead of guessing. */
export function checkCoverage(candles: Candle[], interval: Interval, startMs: number, endMs: number) {
  const step = INTERVAL_MS[interval];
  const issues: string[] = [];
  if (candles.length === 0) return { ok: false, issues: ["no data"] };
  const sorted = [...candles].sort((a, b) => a.openTime - b.openTime);
  if (sorted[0]!.openTime > startMs) issues.push("data starts after window start");
  if (sorted[sorted.length - 1]!.closeTime < endMs) issues.push("data ends before window end (stale or incomplete)");
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.openTime - sorted[i - 1]!.openTime > step) issues.push(`gap at ${new Date(sorted[i - 1]!.openTime).toISOString()}`);
  }
  for (const c of sorted) if (!(c.high >= Math.max(c.open, c.close) && c.low <= Math.min(c.open, c.close) && c.low > 0)) issues.push(`invalid candle ${c.openTime}`);
  return { ok: issues.length === 0, issues };
}
