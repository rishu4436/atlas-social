import type { Candle } from "@atlas/market-data";

export const sma = (xs: number[], n: number) => (xs.length >= n ? xs.slice(-n).reduce((s, x) => s + x, 0) / n : null);

export function ema(xs: number[], n: number): number | null {
  if (xs.length < n) return null;
  const k = 2 / (n + 1);
  let e = xs.slice(0, n).reduce((s, x) => s + x, 0) / n;
  for (const x of xs.slice(n)) e = x * k + e * (1 - k);
  return e;
}

export function rsi(closes: number[], n = 14): number | null {
  if (closes.length <= n) return null;
  let gain = 0, loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = closes[i]! - closes[i - 1]!;
    if (d >= 0) gain += d; else loss -= d;
  }
  gain /= n; loss /= n;
  for (let i = n + 1; i < closes.length; i++) {
    const d = closes[i]! - closes[i - 1]!;
    gain = (gain * (n - 1) + Math.max(d, 0)) / n;
    loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
  }
  if (loss === 0) return 100;
  return 100 - 100 / (1 + gain / loss);
}

export function atr(c: Candle[], n = 14): number | null {
  if (c.length <= n) return null;
  const trs = c.slice(1).map((x, i) => Math.max(x.high - x.low, Math.abs(x.high - c[i]!.close), Math.abs(x.low - c[i]!.close)));
  return trs.slice(-n).reduce((s, x) => s + x, 0) / n;
}

export function realizedVol(closes: number[]): number | null {
  if (closes.length < 3) return null;
  const r = closes.slice(1).map((x, i) => Math.log(x / closes[i]!));
  const m = r.reduce((s, x) => s + x, 0) / r.length;
  return Math.sqrt(r.reduce((s, x) => s + (x - m) ** 2, 0) / (r.length - 1));
}

export function maxDrawdown(closes: number[]): number {
  let peak = -Infinity, mdd = 0;
  for (const x of closes) {
    peak = Math.max(peak, x);
    mdd = Math.max(mdd, (peak - x) / peak);
  }
  return mdd;
}

/** Swing levels: recent local highs/lows (fractals of width 3). */
export function keyLevels(c: Candle[], max = 3) {
  const highs: number[] = [], lows: number[] = [];
  for (let i = 3; i < c.length - 3; i++) {
    const w = c.slice(i - 3, i + 4);
    if (c[i]!.high === Math.max(...w.map((x) => x.high))) highs.push(c[i]!.high);
    if (c[i]!.low === Math.min(...w.map((x) => x.low))) lows.push(c[i]!.low);
  }
  const last = c[c.length - 1]?.close ?? 0;
  return {
    resistance: highs.filter((h) => h > last).sort((a, b) => a - b).slice(0, max),
    support: lows.filter((l) => l < last).sort((a, b) => b - a).slice(0, max),
  };
}

/** Approximate probability that price touches a level within `hours`, using a driftless random walk. */
export function touchProbability(price: number, level: number, hourlyVol: number, hours: number): number {
  if (hourlyVol <= 0 || hours <= 0) return 0;
  const d = Math.abs(Math.log(level / price));
  const s = hourlyVol * Math.sqrt(hours);
  // P(max of BM over T >= d) = 2 * (1 - Phi(d / s))
  return Math.min(1, 2 * (1 - phi(d / s)));
}

function phi(x: number) {
  // Abramowitz-Stegun approximation of the standard normal CDF
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}
