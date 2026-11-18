"use client";
import { useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { fmtPrice } from "@/lib/api";

type Candle = { openTime: number; open: number; high: number; low: number; close: number };
type Level = { price: number; label: string; tone: "up" | "down" | "signal" };

const N = 120; // fixed point count so path morphs smoothly between datasets

function resample(c: Candle[]) {
  if (c.length <= N) return c;
  const out: Candle[] = [];
  for (let i = 0; i < N; i++) out.push(c[Math.floor((i * (c.length - 1)) / (N - 1))]!);
  return out;
}

export function PriceChart({ candles, levels = [], height = 280, mode = "area" }: { candles: Candle[]; levels?: Level[]; height?: number; mode?: "area" | "candles" }) {
  const W = 800, H = height, PAD = 8;
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const data = useMemo(() => resample(candles), [candles]);
  const geo = useMemo(() => {
    if (data.length < 2) return null;
    const lv = levels.map((l) => l.price);
    const min = Math.min(...data.map((c) => c.low), ...lv), max = Math.max(...data.map((c) => c.high), ...lv);
    const r = max - min || 1;
    const y = (v: number) => PAD + (1 - (v - min) / r) * (H - PAD * 2);
    const x = (i: number) => (i / (data.length - 1)) * W;
    // pad to N points so `d` always has the same command count
    const pts = Array.from({ length: N }, (_, i) => { const j = Math.min(data.length - 1, Math.round((i / (N - 1)) * (data.length - 1))); return [x(j), y(data[j]!.close)] as const; });
    const line = `M${pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" L")}`;
    return { y, x, line, area: `${line} L${W},${H} L0,${H} Z`, up: data[data.length - 1]!.close >= data[0]!.close };
  }, [data, levels, H]);

  if (!geo) return <div style={{ height }} className="grid place-items-center text-sm text-ink-faint">No data</div>;
  const color = geo.up ? "#34d399" : "#fb7185";
  const hc = hover !== null ? data[hover] : null;

  return (
    <div className="relative">
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-auto w-full touch-none" style={{ height }}
        onPointerMove={(e) => { const b = ref.current!.getBoundingClientRect(); setHover(Math.max(0, Math.min(data.length - 1, Math.round(((e.clientX - b.left) / b.width) * (data.length - 1))))); }}
        onPointerLeave={() => setHover(null)} role="img" aria-label="Price chart">
        <defs>
          <linearGradient id="area" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={color} stopOpacity="0.28" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} stroke="rgb(148 163 184 / .07)" />)}
        {mode === "area" ? (
          <>
            <motion.path initial={false} animate={{ d: geo.area }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }} fill="url(#area)" />
            <motion.path initial={{ pathLength: 0 }} animate={{ d: geo.line, pathLength: 1 }} transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          </>
        ) : (
          data.map((c, i) => {
            const up = c.close >= c.open, w = (W / data.length) * 0.6, cxp = geo.x(i);
            return (
              <motion.g key={i} initial={{ opacity: 0, scaleY: 0.6 }} animate={{ opacity: 1, scaleY: 1 }} transition={{ delay: i * 0.003, duration: 0.3 }} style={{ originY: 1 }}>
                <line x1={cxp} x2={cxp} y1={geo.y(c.high)} y2={geo.y(c.low)} stroke={up ? "#34d399" : "#fb7185"} strokeOpacity=".7" vectorEffect="non-scaling-stroke" />
                <rect x={cxp - w / 2} width={w} y={geo.y(Math.max(c.open, c.close))} height={Math.max(1, Math.abs(geo.y(c.open) - geo.y(c.close)))} fill={up ? "#34d399" : "#fb7185"} rx="1" />
              </motion.g>
            );
          })
        )}
        {levels.map((l) => (
          <g key={l.label}>
            <motion.line initial={{ opacity: 0 }} animate={{ opacity: 1, y1: geo.y(l.price), y2: geo.y(l.price) }} x1="0" x2={W} stroke={l.tone === "up" ? "#34d399" : l.tone === "down" ? "#fb7185" : "#46e1df"} strokeDasharray="6 6" vectorEffect="non-scaling-stroke" />
          </g>
        ))}
        {hc && <line x1={geo.x(hover!)} x2={geo.x(hover!)} y1="0" y2={H} stroke="rgb(70 225 223 / .4)" vectorEffect="non-scaling-stroke" />}
      </svg>
      {levels.map((l) => (
        <span key={l.label} className={`num pointer-events-none absolute right-1 -translate-y-1/2 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${l.tone === "up" ? "bg-emerald-up/15 text-emerald-up" : l.tone === "down" ? "bg-coral-down/15 text-coral-down" : "bg-signal-dim text-signal"}`} style={{ top: (geo.y(l.price) / H) * height }}>
          {l.label} {fmtPrice(l.price)}
        </span>
      ))}
      <AnimatePresence>
        {hc && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1, x: `calc(${(hover! / (data.length - 1)) * 100}% - 50%)` }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}
            className="glass pointer-events-none absolute left-0 top-2 px-2.5 py-1.5 text-[11px]">
            <div className="num font-semibold">{fmtPrice(hc.close)}</div>
            <div className="text-ink-faint">{new Date(hc.openTime).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
