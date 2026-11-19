"use client";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useWaking, WAKING_MESSAGE } from "@/lib/api";

/** Shown while any request waits for the free-tier API to wake (cold start). Never shows raw errors. */
export function WakingBanner() {
  const waking = useWaking();
  const reduce = useReducedMotion();
  return (
    <AnimatePresence>
      {waking && (
        <motion.div key="waking" role="status" aria-live="polite" data-testid="waking-banner"
          initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}
          className="fixed left-1/2 top-12 z-[70] flex -translate-x-1/2 items-center gap-3 rounded-full border border-signal/25 bg-[#0b1418]/90 px-4 py-2 text-sm text-ink shadow-[0_10px_40px_-12px] shadow-signal/40 backdrop-blur">
          <span className="relative grid h-4 w-4 place-items-center" aria-hidden>
            {!reduce && <motion.span className="absolute inset-0 rounded-full border-2 border-signal/30 border-t-signal" animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }} />}
            {reduce && <span className="h-2 w-2 rounded-full bg-signal" />}
          </span>
          <span>{WAKING_MESSAGE}</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
