"use client";
import * as React from "react";
import { motion, AnimatePresence, useSpring, useTransform, useReducedMotion, type HTMLMotionProps } from "motion/react";
import { spring, fadeUp, stagger, pop } from "./motion";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function Card({ className, hover = true, glow = false, ...p }: HTMLMotionProps<"div"> & { hover?: boolean; glow?: boolean }) {
  return <motion.div className={cx("glass relative overflow-hidden", hover && "glass-hover", glow && "shadow-[var(--shadow-glow)]", className as string)} {...p} />;
}

type BtnVariant = "primary" | "ghost" | "outline" | "danger";
export const Button = React.forwardRef<HTMLButtonElement, HTMLMotionProps<"button"> & { variant?: BtnVariant; size?: "sm" | "md" | "lg"; loading?: boolean }>(
  function Button({ variant = "primary", size = "md", loading, className, children, disabled, ...p }, ref) {
    const v: Record<BtnVariant, string> = {
      primary: "bg-signal text-obsidian font-semibold shadow-[0_0_0_1px_rgb(70_225_223/.4),0_8px_30px_-10px_rgb(70_225_223/.7)] hover:brightness-110",
      ghost: "text-ink-dim hover:text-ink hover:bg-white/5",
      outline: "border border-line-strong text-ink hover:border-signal/50 hover:bg-signal-dim",
      danger: "bg-coral-down/15 text-coral-down border border-coral-down/30 hover:bg-coral-down/25",
    };
    const s = { sm: "h-8 px-3 text-sm rounded-lg", md: "h-10 px-4 text-sm rounded-xl", lg: "h-12 px-6 text-base rounded-2xl" }[size];
    return (
      <motion.button ref={ref} whileHover={disabled ? undefined : { scale: 1.02 }} whileTap={disabled ? undefined : { scale: 0.96 }} transition={spring}
        disabled={disabled || loading} className={cx("relative inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed", v[variant], s, className as string)} {...p}>
        {loading && <span className="absolute inset-0 grid place-items-center"><Spinner /></span>}
        <span className={cx("inline-flex items-center gap-2", loading && "opacity-0")}>{children as React.ReactNode}</span>
      </motion.button>
    );
  },
);

export function Spinner({ className }: { className?: string }) {
  return <motion.span className={cx("inline-block h-4 w-4 rounded-full border-2 border-current border-t-transparent", className)} animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.8, ease: "linear" }} />;
}

export function Badge({ tone = "neutral", children, className }: { tone?: "neutral" | "signal" | "up" | "down" | "warn" | "ai"; children: React.ReactNode; className?: string }) {
  const t = {
    neutral: "bg-white/5 text-ink-dim border-line", signal: "bg-signal-dim text-signal border-signal/30", up: "bg-emerald-up/10 text-emerald-up border-emerald-up/25",
    down: "bg-coral-down/10 text-coral-down border-coral-down/25", warn: "bg-amber-warn/10 text-amber-warn border-amber-warn/25", ai: "bg-violet-400/10 text-violet-300 border-violet-400/25",
  }[tone];
  return <span className={cx("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium tracking-wide", t, className)}>{children}</span>;
}

/** Shimmer skeleton: a translating gradient (transform only). */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cx("relative overflow-hidden rounded-lg bg-white/[0.04]", className)}>
      <div className="absolute inset-0 animate-shimmer bg-gradient-to-r from-transparent via-white/[0.07] to-transparent" />
    </div>
  );
}

export function PostSkeleton() {
  return (
    <Card hover={false} className="p-5">
      <div className="flex items-center gap-3"><Skeleton className="h-10 w-10 rounded-full" /><div className="flex-1 space-y-2"><Skeleton className="h-3 w-32" /><Skeleton className="h-2.5 w-20" /></div></div>
      <div className="mt-4 space-y-2"><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-5/6" /><Skeleton className="h-3 w-2/3" /></div>
      <Skeleton className="mt-4 h-24 w-full rounded-xl" />
    </Card>
  );
}

/** Spring-animated number ticker with tabular numerals. */
export function AnimatedNumber({ value, decimals = 2, prefix = "", suffix = "", className }: { value: number; decimals?: number; prefix?: string; suffix?: string; className?: string }) {
  const reduce = useReducedMotion();
  const s = useSpring(value, { stiffness: 120, damping: 24, mass: 0.6 });
  const text = useTransform(s, (v) => `${prefix}${v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${suffix}`);
  React.useEffect(() => { reduce ? s.jump(value) : s.set(value); }, [value, reduce, s]);
  return <motion.span className={cx("num", className)}>{text}</motion.span>;
}

/** Flash green/red on change (opacity only). */
export function PriceFlash({ value, children }: { value: number; children: React.ReactNode }) {
  const prev = React.useRef(value);
  const [dir, setDir] = React.useState<0 | 1 | -1>(0);
  React.useEffect(() => { if (value !== prev.current) { setDir(value > prev.current ? 1 : -1); prev.current = value; const t = setTimeout(() => setDir(0), 700); return () => clearTimeout(t); } }, [value]);
  return (
    <span className="relative inline-block">
      <AnimatePresence>{dir !== 0 && <motion.span key={`${dir}${value}`} initial={{ opacity: 0.5 }} animate={{ opacity: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.7 }} className={cx("absolute -inset-1 rounded-md", dir > 0 ? "bg-emerald-up/25" : "bg-coral-down/25")} />}</AnimatePresence>
      <span className="relative">{children}</span>
    </span>
  );
}

/** Tabs with a spring-driven sliding indicator (shared layoutId). */
export function Tabs<T extends string>({ tabs, value, onChange, id, className }: { tabs: { value: T; label: React.ReactNode }[]; value: T; onChange: (v: T) => void; id: string; className?: string }) {
  return (
    <div role="tablist" className={cx("relative flex gap-1 rounded-2xl border border-line bg-white/[0.02] p-1", className)}>
      {tabs.map((t) => {
        const active = t.value === value;
        return (
          <button key={t.value} role="tab" aria-selected={active} onClick={() => onChange(t.value)} className={cx("relative z-10 flex-1 rounded-xl px-3 py-2 text-sm font-medium transition-colors", active ? "text-ink" : "text-ink-dim hover:text-ink")}>
            {active && <motion.span layoutId={`tab-${id}`} transition={spring} className="absolute inset-0 -z-10 rounded-xl bg-gradient-to-b from-white/[0.09] to-white/[0.03] shadow-[inset_0_0_0_1px_rgb(70_225_223/.25),0_0_24px_-8px_rgb(70_225_223/.5)]" />}
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

export function Avatar({ name, src, size = 40, ai = false }: { name: string; src?: string | null; size?: number; ai?: boolean }) {
  const hue = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  return (
    <span className="relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full font-semibold text-obsidian" style={{ width: size, height: size, fontSize: size * 0.38, background: src ? undefined : `linear-gradient(135deg, hsl(${hue} 80% 70%), hsl(${(hue + 60) % 360} 70% 55%))` }}>
      {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : name.replace(/\.ai$/, "").slice(0, 2).toUpperCase()}
      {ai && <span className="absolute -bottom-0.5 -right-0.5 rounded-full bg-violet-400 px-1 text-[8px] font-bold text-obsidian">AI</span>}
    </span>
  );
}

export function StaggerList({ children, className, gap = 0.05 }: { children: React.ReactNode; className?: string; gap?: number }) {
  return <motion.div variants={stagger(gap)} initial="hidden" animate="show" className={className}>{children}</motion.div>;
}
export function StaggerItem({ children, className, ...p }: HTMLMotionProps<"div">) {
  return <motion.div variants={fadeUp} layout="position" className={className as string} {...p}>{children}</motion.div>;
}

/** The "On-chain Committed" badge: pop-in with a sweeping highlight and pulse ring. */
export function CommittedBadge({ label = "On-chain Committed", reveal = true }: { label?: string; reveal?: boolean }) {
  return (
    <motion.span variants={pop} initial={reveal ? "hidden" : false} animate="show" className="relative inline-flex items-center gap-1.5 overflow-hidden rounded-full border border-signal/40 bg-signal-dim px-2.5 py-1 text-[11px] font-semibold text-signal">
      <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-pulse-ring rounded-full bg-signal" /><span className="relative inline-flex h-2 w-2 rounded-full bg-signal" /></span>
      {label}
      {reveal && <motion.span initial={{ x: "-120%" }} animate={{ x: "220%" }} transition={{ duration: 1.1, delay: 0.25, ease: [0.22, 1, 0.36, 1] }} className="pointer-events-none absolute inset-y-0 w-1/3 -skew-x-12 bg-gradient-to-r from-transparent via-white/40 to-transparent" />}
    </motion.span>
  );
}

/** Heart-style toggle with particle burst. */
export function ReactionButton({ active, count, onToggle, icon, activeClass = "text-coral-down", label }: { active: boolean; count: number; onToggle: () => void; icon: (active: boolean) => React.ReactNode; activeClass?: string; label: string }) {
  const [burst, setBurst] = React.useState(0);
  return (
    <motion.button aria-label={label} aria-pressed={active} whileTap={{ scale: 0.8 }} transition={spring} onClick={() => { if (!active) setBurst((b) => b + 1); onToggle(); }} className={cx("group relative inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-sm transition-colors", active ? activeClass : "text-ink-dim hover:text-ink")}>
      <span className="relative">
        <motion.span key={String(active)} initial={{ scale: active ? 0.4 : 1 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 600, damping: 15 }} className="inline-flex">{icon(active)}</motion.span>
        <AnimatePresence>
          {burst > 0 && active && [...Array(6)].map((_, i) => (
            <motion.span key={`${burst}-${i}`} initial={{ opacity: 1, x: 0, y: 0, scale: 1 }} animate={{ opacity: 0, x: Math.cos((i / 6) * Math.PI * 2) * 14, y: Math.sin((i / 6) * Math.PI * 2) * 14, scale: 0.4 }} transition={{ duration: 0.5 }} className={cx("absolute left-1/2 top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-current")} />
          ))}
        </AnimatePresence>
      </span>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span key={count} initial={{ y: 8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -8, opacity: 0 }} transition={{ duration: 0.18 }} className="num text-xs">{count}</motion.span>
      </AnimatePresence>
    </motion.button>
  );
}

export function Sparkline({ data, up, width = 120, height = 36, className }: { data: number[]; up?: boolean; width?: number; height?: number; className?: string }) {
  if (data.length < 2) return <div style={{ width, height }} />;
  const min = Math.min(...data), max = Math.max(...data), r = max - min || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * width},${height - ((v - min) / r) * (height - 4) - 2}`);
  const d = `M${pts.join(" L")}`;
  const color = (up ?? data[data.length - 1]! >= data[0]!) ? "#34d399" : "#fb7185";
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} aria-hidden>
      <defs><linearGradient id={`sg${color.slice(1)}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={color} stopOpacity="0.25" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient></defs>
      <motion.path d={`${d} L${width},${height} L0,${height} Z`} fill={`url(#sg${color.slice(1)})`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6 }} />
      <motion.path d={d} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }} />
    </svg>
  );
}

export function Modal({ open, onClose, children, title }: { open: boolean; onClose: () => void; children: React.ReactNode; title?: string }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 grid place-items-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
          <motion.div role="dialog" aria-modal aria-label={title} initial={{ opacity: 0, y: 24, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: 0.98 }} transition={spring} className="glass relative w-full max-w-lg p-6">
            {title && <h2 className="mb-4 text-lg font-semibold">{title}</h2>}
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export { cx };
