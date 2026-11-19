"use client";
import * as React from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { Copy, Check, AlertTriangle, RefreshCw, Link2, Clock, Info, ShieldAlert, ChevronDown, Ban } from "lucide-react";
import { Button, Badge, cx } from "@atlas/design-system";
import type { Explained } from "@/lib/auth-errors";

// ------------------------------------------------------------------ countdown

/** Seconds left on a challenge, corrected for clock skew between this device and the API. */
export function useCountdown(expiresAt: number | undefined, serverNow: number | undefined) {
  // skew is captured synchronously when a challenge arrives, so the first render already has the right value
  const skew = React.useMemo(() => (serverNow ? serverNow - Date.now() / 1000 : 0), [serverNow, expiresAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    if (!expiresAt) return;
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [expiresAt]);
  return expiresAt ? Math.max(0, Math.floor(expiresAt - (Date.now() / 1000 + skew))) : 0;
}

export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export function ChallengeTimer({ left, total = 300, stale }: { left: number; total?: number; stale?: boolean }) {
  const r = 18; const C = 2 * Math.PI * r;
  const frac = stale ? 0 : Math.max(0, Math.min(1, left / total));
  const tone = stale || left === 0 ? "text-coral-down" : left <= 60 ? "text-amber-warn" : "text-signal";
  return (
    <div role="timer" aria-live="off" aria-label={stale ? "Challenge expired" : `Challenge expires in ${mmss(left)}`} data-testid="challenge-timer" data-left={left}
      className={cx("inline-flex items-center gap-2 rounded-full border border-line bg-black/30 py-1 pl-1 pr-3", tone)}>
      <svg width="44" height="44" viewBox="0 0 44 44" className="-rotate-90" aria-hidden>
        <circle cx="22" cy="22" r={r} className="stroke-white/10" strokeWidth="4" fill="none" />
        <circle cx="22" cy="22" r={r} stroke="currentColor" strokeWidth="4" fill="none" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - frac)} style={{ transition: "stroke-dashoffset 1s linear" }} />
      </svg>
      <div className="leading-tight">
        <div className="num text-sm font-semibold">{stale || left === 0 ? "Expired" : mmss(left)}</div>
        <div className="text-[10px] uppercase tracking-wider text-ink-faint">{stale || left === 0 ? "commands stale" : "challenge valid"}</div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ command block with stale state

export function CommandBlock({ n, title, cmd, why, check, stale, staleReason = "Challenge expired", testId, placeholder }: {
  n?: number | string; title: string; cmd: string; why?: React.ReactNode; check?: React.ReactNode; stale?: boolean; staleReason?: string; testId?: string; placeholder?: boolean;
}) {
  const [ok, setOk] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const copy = () => { if (stale) return; void navigator.clipboard?.writeText(cmd).catch(() => {}); setOk(true); setTimeout(() => setOk(false), 1400); };
  return (
    <motion.div layout="position" data-testid={testId} data-stale={stale ? "true" : "false"} className={cx("rounded-2xl border p-3 sm:p-4 transition-colors", stale ? "border-coral-down/25 bg-coral-down/[0.04]" : "border-line bg-white/[0.02]")}>
      <div className="flex items-start gap-3">
        {n !== undefined && <span className={cx("num mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold", stale ? "bg-coral-down/15 text-coral-down" : "bg-signal-dim text-signal")}>{n}</span>}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm font-semibold">{title}</div>
            {stale && <Badge tone="down"><Ban className="h-3 w-3" />Stale · {staleReason}</Badge>}
            {placeholder && !stale && <Badge tone="warn">fill after previous step</Badge>}
          </div>
          {why && <div className="mt-1 text-xs leading-relaxed text-ink-dim">{why}</div>}
          <div className="relative mt-2">
            <pre aria-label={`${title} command`} className={cx("max-h-44 overflow-auto whitespace-pre-wrap break-all rounded-xl border border-line bg-black/50 p-3 pr-11 font-mono text-[11.5px] leading-relaxed", stale ? "text-ink-faint line-through decoration-coral-down/60" : "text-ink")}>{cmd}</pre>
            <motion.button type="button" whileTap={stale ? undefined : { scale: 0.85 }} onClick={copy} disabled={stale}
              aria-label={stale ? `${title}: stale, cannot copy` : `Copy ${title} command`}
              className="absolute right-2 top-2 rounded-lg p-1.5 text-ink-dim hover:bg-white/10 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40">
              <AnimatePresence mode="wait" initial={false}>
                <motion.span key={String(ok)} initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.5, opacity: 0 }} className="block">
                  {ok ? <Check className="h-4 w-4 text-emerald-up" /> : <Copy className="h-4 w-4" />}
                </motion.span>
              </AnimatePresence>
            </motion.button>
          </div>
          {check && (
            <>
              <button type="button" onClick={() => setOpen(!open)} className="mt-2 inline-flex items-center gap-1 text-xs text-signal hover:underline" aria-expanded={open}>
                What to check in the output <motion.span animate={{ rotate: open ? 180 : 0 }}><ChevronDown className="h-3.5 w-3.5" /></motion.span>
              </button>
              <AnimatePresence initial={false}>
                {open && <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden"><div className="mt-2 rounded-xl bg-white/[0.03] p-3 text-xs leading-relaxed text-ink-dim">{check}</div></motion.div>}
              </AnimatePresence>
            </>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ------------------------------------------------------------------ error explainer

export function ErrorExplainer({ err, onRegenerate, onFallback, onRetry, onDismiss, busy }: {
  err: Explained; onRegenerate?: () => void; onFallback?: () => void; onRetry?: () => void; onDismiss?: () => void; busy?: boolean;
}) {
  const stop = err.action === "stop";
  const retryAfter = err.details?.retryAfterSeconds as number | undefined;
  return (
    <motion.div role="alert" data-testid="auth-error" data-code={err.code} initial={{ opacity: 0, y: 8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6 }}
      className={cx("rounded-2xl border p-4", stop ? "border-coral-down/40 bg-coral-down/[0.08]" : err.action === "wait" ? "border-amber-warn/30 bg-amber-warn/[0.06]" : "border-coral-down/25 bg-coral-down/[0.05]")}>
      <div className="flex gap-3">
        {stop ? <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-coral-down" /> : err.action === "wait" ? <Clock className="mt-0.5 h-5 w-5 shrink-0 text-amber-warn" /> : <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-coral-down" />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><div className="font-semibold">{err.title}</div><code className="rounded bg-black/30 px-1.5 py-0.5 text-[10px] text-ink-faint">{err.code}</code></div>
          <p className="mt-1 text-sm text-ink-dim">{err.message}</p>
          <p className="mt-2 text-sm"><span className="font-medium text-ink">Fix: </span><span className="text-ink-dim">{err.fix}</span>{retryAfter ? <span className="text-ink-dim"> (about {retryAfter}s)</span> : null}</p>
          {err.details?.recoveredAddress && (
            <p className="mt-2 text-xs text-ink-dim">Signed by <span className="hash text-ink">{err.details.recoveredAddress}</span>, expected <span className="hash text-ink">{err.details.expectedAddress}</span>.</p>
          )}
          {err.details?.challengeBurned && <p className="mt-2 text-xs text-ink-faint">For safety, a rejected attempt burns the challenge. A new one has been issued below.</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            {err.action === "regenerate" && onRegenerate && !err.details?.challengeBurned && <Button size="sm" onClick={onRegenerate} loading={busy}><RefreshCw className="h-3.5 w-3.5" />New challenge</Button>}
            {(err.fallback || err.action === "fallback") && onFallback && <Button size="sm" onClick={onFallback}><Link2 className="h-3.5 w-3.5" />Use the on-chain proof</Button>}
            {(err.action === "wait" || err.action === "passkey") && onRetry && <Button size="sm" variant="outline" onClick={onRetry} loading={busy}><RefreshCw className="h-3.5 w-3.5" />Try again</Button>}
            {onDismiss && <Button size="sm" variant="ghost" onClick={onDismiss}>Dismiss</Button>}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ------------------------------------------------------------------ stepper

export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <nav aria-label="Onboarding progress" className="w-full">
      <ol className="flex items-center gap-1.5 sm:gap-2">
        {steps.map((s, i) => {
          const state = i < current ? "done" : i === current ? "current" : "todo";
          return (
            <li key={s} className="flex min-w-0 flex-1 flex-col gap-1.5" aria-current={state === "current" ? "step" : undefined}>
              <div className="relative h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
                <motion.div className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-signal/70 to-signal" initial={false}
                  animate={{ width: state === "todo" ? "0%" : "100%" }} transition={{ type: "spring", stiffness: 140, damping: 24 }} />
              </div>
              <span className={cx("truncate text-[11px] sm:text-xs", state === "current" ? "font-semibold text-ink" : state === "done" ? "text-signal" : "text-ink-faint", state !== "current" && "max-sm:hidden")}>
                <span className="num">{i + 1}</span>&nbsp;{s}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function SafetyNote({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <div className={cx("flex gap-2 rounded-xl border border-emerald-up/20 bg-emerald-up/[0.05] p-3 text-xs leading-relaxed text-ink-dim", className)}>
      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-emerald-up" />
      <div>{children ?? <><b className="text-ink">Never share your seed phrase, private key or API secrets</b> with anyone, including ATLAS. ATLAS never runs these commands, never asks for keys, and has no QR or pairing-code login. You run every command on your own machine and approve every request yourself.</>}</div>
    </div>
  );
}

export function InfoNote({ children }: { children: React.ReactNode }) {
  return <div className="flex gap-2 text-xs leading-relaxed text-ink-dim"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-signal" /><div>{children}</div></div>;
}

/** Pulsing dot that stays still for reduced-motion users. */
export function LiveDot({ className }: { className?: string }) {
  const reduce = useReducedMotion();
  return <motion.span aria-hidden className={cx("inline-block h-2 w-2 rounded-full bg-signal", className)} animate={reduce ? undefined : { opacity: [1, 0.35, 1] }} transition={{ duration: 1.6, repeat: Infinity }} />;
}
