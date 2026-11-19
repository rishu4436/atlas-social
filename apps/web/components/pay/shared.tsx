"use client";
import * as React from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { X } from "lucide-react";
import { cx, spring } from "@atlas/design-system";
import { useApi } from "@/lib/api";

export type PayAsset = "BNB" | "USDT";
export interface PayRecipient { userId: string; agentName: string; displayName?: string | null; avatarUrl?: string | null }

export function usePayConfig() {
  const c = useApi<any>("/pay/config");
  return { cfg: c.data, pending: c.data?.status === "pending", loading: !c.data && !c.error, error: c.error };
}

/** Bottom sheet on phones, floating panel on desktop. Transform/opacity only; respects reduced motion. */
export function Sheet({ open, onClose, children, label, testId }: { open: boolean; onClose: () => void; children: React.ReactNode; label: string; testId?: string }) {
  const reduce = useReducedMotion();
  React.useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    const prev = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", k); document.body.style.overflow = prev; };
  }, [open, onClose]);
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  // Portalled to <body> so a transformed ancestor (animated cards) cannot clip or offset it; clicks are stopped
  // so they never reach a clickable parent such as a post card that navigates on click.
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <motion.div className="absolute inset-0 bg-black/65 backdrop-blur-sm" onClick={onClose} aria-hidden />
          <motion.div role="dialog" aria-modal aria-label={label} data-testid={testId}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 48, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={reduce ? { opacity: 0 } : { opacity: 0, y: 32, scale: 0.98 }} transition={spring}
            className="glass relative max-h-[92dvh] w-full overflow-y-auto rounded-b-none rounded-t-3xl border border-line p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:max-w-[30rem] sm:rounded-3xl sm:p-6">
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/15 sm:hidden" aria-hidden />
            <button onClick={onClose} aria-label="Close" className="absolute right-4 top-4 rounded-full p-1.5 text-ink-faint hover:bg-white/10 hover:text-ink"><X className="h-4 w-4" /></button>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export function StepDots({ steps, at }: { steps: string[]; at: number }) {
  return (
    <ol className="flex items-center gap-1.5" aria-label="Progress">
      {steps.map((s, i) => (
        <li key={s} className="flex items-center gap-1.5" aria-current={i === at ? "step" : undefined}>
          <motion.span layout className={cx("h-1.5 rounded-full", i < at ? "w-4 bg-signal/60" : i === at ? "w-8 bg-signal" : "w-4 bg-white/10")} transition={spring} />
          <span className={cx("hidden text-[10px] uppercase tracking-wider sm:inline", i === at ? "text-ink" : "text-ink-faint")}>{s}</span>
        </li>
      ))}
    </ol>
  );
}

/** Full address, never truncated, grouped for reading. */
export function FullAddress({ address, testId }: { address: string; testId?: string }) {
  const groups = address.slice(2).match(/.{1,4}/g) ?? [];
  return (
    <div data-testid={testId} data-address={address} className="break-all font-mono text-[13px] leading-relaxed text-ink" aria-label={address}>
      <span className="text-ink-faint">0x</span>{groups.map((g, i) => <span key={i} className={i % 2 ? "text-ink" : "text-signal/90"}>{g}</span>)}
    </div>
  );
}

export function AssetToggle({ value, onChange, disabled }: { value: PayAsset; onChange: (a: PayAsset) => void; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label="Asset" className="relative inline-flex rounded-full border border-line bg-black/30 p-1">
      {(["BNB", "USDT"] as const).map((a) => (
        <button key={a} role="radio" aria-checked={value === a} disabled={disabled} onClick={() => onChange(a)} className={cx("relative z-10 rounded-full px-4 py-1.5 text-sm font-medium transition-colors", value === a ? "text-obsidian" : "text-ink-dim hover:text-ink", disabled && "cursor-not-allowed")}>
          {value === a && <motion.span layoutId="asset-pill" className="absolute inset-0 -z-10 rounded-full bg-signal" transition={spring} />}
          {a}
        </button>
      ))}
    </div>
  );
}

export const kindLabel = (k: string, ctx?: string) => k === "tip" ? (ctx === "thesis" ? "Tip on thesis" : "Tip on post") : k === "request" ? "Pays a request" : ctx === "dm" ? "Payment in conversation" : "Direct payment";

export function PayPendingNotice({ className = "" }: { className?: string }) {
  return (
    <div role="status" data-testid="pay-pending" className={`flex gap-3 rounded-2xl border border-amber-warn/25 bg-amber-warn/[0.06] p-4 text-sm ${className}`}>
      <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 animate-pulse rounded-full bg-amber-warn" />
      <div>
        <div className="font-medium text-amber-warn">Contracts pending deployment</div>
        <p className="mt-1 text-ink-dim">AtlasPay is not deployed on this chain yet, so ATLAS cannot prepare a payment and will not simulate one. Nothing has been sent. You can still pay with the official Binance Agentic Wallet flow below, from your own wallet.</p>
      </div>
    </div>
  );
}
