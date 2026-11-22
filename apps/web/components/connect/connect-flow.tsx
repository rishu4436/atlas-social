"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { Bot, Terminal, Plug, Check, Wallet, ShieldCheck, Smartphone, AlertTriangle, RotateCcw, X, ArrowRight, ExternalLink, Fingerprint, Laptop, KeyRound, Info } from "lucide-react";
import { Button, Badge, Tabs, CommittedBadge, cx } from "@atlas/design-system";
import { CONNECT_STAGE_LABEL, CONNECT_SITE, CONNECT_PACKAGE, type ConnectStage } from "@atlas/auth/connect";
import { CopyBlock } from "@/components/tx-panel";
import { useConnect } from "./use-connect";
import { useWaking, WAKING_MESSAGE } from "@/lib/api";

export const ISSUE_400 = "https://github.com/binance/binance-skills-hub/issues/400";
export const ISSUE_375 = "https://github.com/binance/binance-skills-hub/issues/375";

/** Binance-style hexagon mark (decorative, not a logo copy). */
export function WalletMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className}>
      <path d="M12 2.5 20.2 7.2v9.6L12 21.5 3.8 16.8V7.2z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="m12 8 4 4-4 4-4-4z" fill="currentColor" />
    </svg>
  );
}

function useSecondsLeft(expiresAt?: number, skew = 0) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000) + skew);
  useEffect(() => { const t = setInterval(() => setNow(Math.floor(Date.now() / 1000) + skew), 1000); return () => clearInterval(t); }, [skew]);
  return expiresAt ? Math.max(0, expiresAt - now) : 0;
}

const STEPS = [
  { key: "handoff", label: "Hand off", icon: Bot },
  { key: "wallet", label: "Wallet detected", icon: Wallet },
  { key: "approve", label: "Approve in wallet", icon: Smartphone },
  { key: "confirm", label: "Confirm here", icon: ShieldCheck },
] as const;

function stepIndex(status?: string, stage?: ConnectStage | null) {
  if (status === "approved" || status === "redeemed" || status === "submitted") return 3;
  if (stage === "previewing" || stage === "awaiting_user_approval" || stage === "awaiting_app_confirmation" || stage === "signed") return 2;
  if (status === "challenge_issued" || stage === "wallet_checked") return 1;
  return 0;
}

export function ConnectStepper({ status, stage }: { status?: string; stage?: ConnectStage | null }) {
  const at = stepIndex(status, stage);
  return (
    <ol className="relative grid grid-cols-4 gap-1" aria-label="Connection progress">
      <div className="absolute left-[12.5%] right-[12.5%] top-4 h-px bg-line" aria-hidden />
      <motion.div className="absolute left-[12.5%] top-4 h-px origin-left bg-gradient-to-r from-signal to-emerald-up" aria-hidden
        initial={false} animate={{ scaleX: at / 3 }} style={{ width: "75%" }} transition={{ type: "spring", stiffness: 140, damping: 24 }} />
      {STEPS.map((s, i) => {
        const done = i < at, active = i === at;
        return (
          <li key={s.key} className="relative z-10 flex flex-col items-center gap-1.5 text-center" aria-current={active ? "step" : undefined}>
            <motion.span initial={false} animate={{ scale: active ? 1.08 : 1 }}
              className={cx("grid h-8 w-8 place-items-center rounded-full border text-xs transition-colors",
                done ? "border-emerald-up/50 bg-emerald-up/15 text-emerald-up" : active ? "border-signal/60 bg-signal/15 text-signal shadow-[0_0_24px_-6px] shadow-signal" : "border-line bg-panel text-ink-faint")}>
              {done ? <Check className="h-4 w-4" /> : <s.icon className="h-4 w-4" />}
            </motion.span>
            <span className={cx("text-[11px] leading-tight", active ? "text-ink" : "text-ink-faint")}>{s.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function Pulse({ tone = "signal" }: { tone?: "signal" | "warn" }) {
  const reduce = useReducedMotion();
  const c = tone === "warn" ? "bg-amber-300" : "bg-signal";
  return (
    <span className="relative inline-flex h-2.5 w-2.5">
      {!reduce && <motion.span className={cx("absolute inset-0 rounded-full", c)} animate={{ scale: [1, 2.2], opacity: [0.6, 0] }} transition={{ duration: 1.4, repeat: Infinity, ease: "easeOut" }} />}
      <span className={cx("relative inline-flex h-2.5 w-2.5 rounded-full", c)} />
    </span>
  );
}

export const DEV_MODE_HINT = "Turn on Developer Mode in Binance App → Agentic Wallet → Settings";
export const DEV_MODE_CODES = new Set(["351802"]); // Developer Mode off/expired

const HOW = [
  { icon: Laptop, title: "Your wallet lives with baw", text: "on a computer, or inside your AI agent, where you signed in to Binance Agentic Wallet." },
  { icon: Bot, title: "Give it this code", text: "paste the instruction below into your agent, or run the terminal command." },
  { icon: ShieldCheck, title: "Approve", text: "it previews the ATLAS message; nothing is signed until you say yes (and confirm in the Binance App if asked)." },
  { icon: Check, title: "Finish here", text: "this page updates by itself. Confirm it's you, in this browser." },
] as const;

/** Short "How this works", incl. the phone case: run the code where baw is signed in, finish on the phone. */
export function HowItWorks() {
  return (
    <details data-testid="connect-how" className="group rounded-2xl border border-line bg-black/20 open:bg-black/25" open>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-xs font-medium text-ink [&::-webkit-details-marker]:hidden">
        <Info className="h-3.5 w-3.5 text-signal" />How this works
        <span className="ml-auto text-ink-faint transition-transform group-open:rotate-90 motion-reduce:transition-none" aria-hidden>›</span>
      </summary>
      <ol className="space-y-2 px-3 pb-3">
        {HOW.map((h, i) => (
          <motion.li key={h.title} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.04 * i }} className="flex gap-2.5 text-xs leading-relaxed text-ink-dim">
            <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-signal/10 text-[10px] font-semibold text-signal">{i + 1}</span>
            <span><b className="font-medium text-ink">{h.title}</b>: {h.text}</span>
          </motion.li>
        ))}
      </ol>
      <div data-testid="connect-phone-note" className="mx-3 mb-3 flex gap-2.5 rounded-xl border border-signal/20 bg-signal/5 p-2.5 text-xs leading-relaxed text-ink-dim">
        <Smartphone className="mt-0.5 h-4 w-4 shrink-0 text-signal" />
        <span><b className="font-medium text-ink">On your phone?</b> Keep this page open. Send the code to the computer or AI agent where <span className="hash">baw</span> is signed in and run it there, then come back here to confirm. No QR code or pairing is involved.</span>
      </div>
    </details>
  );
}


function defaultCommandTab(): "windows" | "posix" | "npx" {
  if (typeof navigator === "undefined") return "npx";
  const plat = `${navigator.platform ?? ""} ${navigator.userAgent ?? ""}`;
  if (/Win/i.test(plat)) return "windows";
  if (/Mac|Linux|X11|Unix|iPhone|iPad|Android/i.test(plat)) return "posix";
  return "npx";
}

/** One-liners even if the API has not yet started returning `handoff.commands`. */
export function connectCommands(code: string, purpose: "login" | "step-up" | "pay", handoff: any) {
  if (handoff?.commands?.npx && handoff?.commands?.posix && handoff?.commands?.windows) return handoff.commands as { npx: string; posix: string; windows: string };
  const sub = purpose === "pay" ? "pay" : "login";
  const npx = typeof handoff?.terminal === "string" && handoff.terminal.includes(CONNECT_PACKAGE)
    ? handoff.terminal
    : `npx --yes ${CONNECT_PACKAGE}@latest ${sub} ${code}`;
  const posix = purpose === "pay"
    ? `curl -fsSL ${CONNECT_SITE}/connect.sh | sh -s -- pay ${code}`
    : `curl -fsSL ${CONNECT_SITE}/connect.sh | sh -s ${code}`;
  const windows = purpose === "pay"
    ? `iex "& { $(irm ${CONNECT_SITE}/connect.ps1) } pay ${code}"`
    : `iex "& { $(irm ${CONNECT_SITE}/connect.ps1) } ${code}"`;
  return { npx, posix, windows };
}

function CommandTabs({ code, handoff, purpose }: { code: string; handoff: any; purpose: "login" | "step-up" | "pay" }) {
  const cmds = connectCommands(code, purpose, handoff);
  const [tab, setTab] = useState<"windows" | "posix" | "npx">(defaultCommandTab);
  const current = tab === "windows" ? cmds.windows : tab === "posix" ? cmds.posix : cmds.npx;
  const label = tab === "windows" ? "Windows (PowerShell)" : tab === "posix" ? "macOS / Linux" : "npx";
  return (
    <div className="space-y-2.5">
      <p className="text-xs leading-relaxed text-ink-dim">One command installs anything missing (Node if the script can, the official <span className="hash">baw</span> CLI, and Binance sign-in if needed), then previews the ATLAS message. Nothing is signed until you type <b>y</b>.</p>
      <Tabs id={`connect-cmd-${purpose}`} value={tab} onChange={setTab} tabs={[
        { value: "windows", label: "Windows" },
        { value: "posix", label: "macOS / Linux" },
        { value: "npx", label: "npx" },
      ]} />
      <CopyBlock label={label} text={current} />
      <p className="text-[11px] leading-relaxed text-ink-faint">Run it in a terminal on the computer where you use Binance Agentic Wallet. After it previews, type y only if the message looks right.</p>
    </div>
  );
}

export function HandoffPanel({ code, handoff, purpose }: { code: string; handoff: any; purpose: "login" | "step-up" | "pay" }) {
  const [tab, setTab] = useState<"agent" | "terminal" | "mcp">("agent");
  return (
    <div className="space-y-3">
      <Tabs id={`handoff-${purpose}`} value={tab} onChange={setTab} tabs={[
        { value: "agent", label: <span className="inline-flex items-center gap-1.5"><Bot className="h-3.5 w-3.5" />Your AI agent</span> },
        { value: "terminal", label: <span className="inline-flex items-center gap-1.5"><Terminal className="h-3.5 w-3.5" />Terminal</span> },
        { value: "mcp", label: <span className="inline-flex items-center gap-1.5"><Plug className="h-3.5 w-3.5" />MCP</span> },
      ]} />
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }} className="space-y-2">
          {tab === "agent" && (<>
            <p className="text-xs text-ink-dim">Paste this into the AI agent or assistant that has the Binance Agentic Wallet skill on your computer. It previews first and asks you before signing.</p>
            <CopyBlock label="instruction for your agent" text={handoff.agentPrompt} mono={false} />
          </>)}
          {tab === "terminal" && (
            <CommandTabs code={code} handoff={handoff} purpose={purpose} />
          )}
          {tab === "mcp" && (<>
            <p className="text-xs text-ink-dim">Agents that speak MCP can use the public ATLAS Connect server. No token: every tool needs this code, and none can sign you in.</p>
            <CopyBlock label="MCP server" text={handoff.mcp.config} />
            <CopyBlock label="connection code" text={code} />
          </>)}
        </motion.div>
      </AnimatePresence>
      <p data-testid="connect-devmode-hint" className="flex items-start gap-2 text-[11px] leading-relaxed text-ink-faint">
        <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>{DEV_MODE_HINT} (needed to sign). Your agent never needs your Binance password or keys.</span>
      </p>
    </div>
  );
}

export function CountdownRing({ left, total }: { left: number; total: number }) {
  const r = 15, c = 2 * Math.PI * r, frac = total ? left / total : 0;
  const mm = Math.floor(left / 60), ss = String(left % 60).padStart(2, "0");
  return (
    <span className="inline-flex items-center gap-2 text-xs text-ink-dim" aria-label={`${mm} minutes ${ss} seconds left`}>
      <svg viewBox="0 0 36 36" className="h-7 w-7 -rotate-90"><circle cx="18" cy="18" r={r} className="fill-none stroke-white/10" strokeWidth="3" />
        <motion.circle cx="18" cy="18" r={r} className={cx("fill-none", left < 60 ? "stroke-amber-300" : "stroke-signal")} strokeWidth="3" strokeLinecap="round" strokeDasharray={c} initial={false} animate={{ strokeDashoffset: c * (1 - frac) }} transition={{ duration: 0.4 }} /></svg>
      <span className="tabular-nums">{mm}:{ss}</span>
    </span>
  );
}

export function StatusLine({ status, stage, detail, agentName }: { status?: string; stage?: ConnectStage | null; detail?: any; agentName?: string | null }) {
  const failed = stage === "failed";
  const text = status === "approved" ? "Verified: signature + Agent ID ownership on BSC"
    : failed ? (detail?.bawCode === "953004" ? "Your wallet could not preview the ATLAS message (953004)" : DEV_MODE_CODES.has(String(detail?.bawCode)) ? `Developer Mode is off. ${DEV_MODE_HINT}, then run the code again.` : `The handoff reported a problem${detail?.errorCode ? `: ${detail.errorCode}` : detail?.bawCode ? ` (baw ${detail.bawCode})` : ""}`)
    : stage ? CONNECT_STAGE_LABEL[stage] : "Waiting for your agent or terminal…";
  return (
    <div role="status" data-testid="connect-status" aria-live="polite" className={cx("flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-sm", failed ? "border-amber-300/30 bg-amber-300/5 text-amber-200" : "border-line bg-black/25 text-ink-dim")}>
      {failed ? <AlertTriangle className="h-4 w-4 shrink-0" /> : status === "approved" ? <Check className="h-4 w-4 shrink-0 text-emerald-up" /> : <Pulse />}
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={text} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.2 }}>
          {text}{agentName && status !== "approved" && !failed && stage && stage !== "handoff_started" ? <> · <b className="text-ink">{agentName}</b></> : null}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}

/**
 * "Continue with Binance Agentic Wallet". Browser-first: no address typing, no QR, no pairing code.
 * login → new users go to profile setup, existing users to their account. step-up → refreshes "Agentic Wallet available".
 */
export function ConnectFlow({ purpose, onDone, compact = false }: { purpose: "login" | "step-up"; onDone: (r: any) => void; compact?: boolean }) {
  const c = useConnect({ purpose });
  const waking = useWaking();
  const left = useSecondsLeft(c.view?.expiresAt, c.skew);
  const v = c.view;
  const [done, setDone] = useState<any>(null);
  const expired = v?.status === "expired" || (!!v && left === 0 && v.status !== "redeemed");
  const failedHard = v?.status === "failed" || v?.status === "cancelled";
  const isFallbackCode = v?.stage === "failed" && v?.stageDetail?.bawCode === "953004";

  if (!c.created) {
    return (
      <div className="space-y-3">
        <motion.button type="button" data-testid={`connect-start-${purpose}`} onClick={c.start} disabled={c.busy} whileHover={{ y: -2 }} whileTap={{ scale: 0.98 }}
          className="group relative flex w-full items-center justify-center gap-3 overflow-hidden rounded-2xl bg-gradient-to-r from-[#F0B90B] to-[#F8D33A] px-5 py-4 text-base font-semibold text-[#1a1404] shadow-[0_10px_40px_-12px_rgba(240,185,11,0.6)] disabled:opacity-60">
          <span aria-hidden className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/40 to-transparent transition-transform duration-700 group-hover:translate-x-full motion-reduce:hidden" />
          <WalletMark className="h-5 w-5" />
          {c.busy && waking ? <span data-testid="connect-waking">{WAKING_MESSAGE}</span> : purpose === "login" ? "Continue with Binance Agentic Wallet" : "Check wallet with Agentic Wallet"}
          {c.busy ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#1a1404]/30 border-t-[#1a1404]" /> : <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />}
        </motion.button>
        {!compact && <p className="text-center text-[11px] text-ink-faint">No address to type. Your own agent runs the official <span className="hash">baw</span> preview, you approve, and you finish here.</p>}
        {c.error && <p role="alert" className="text-sm text-coral-down">{c.error.message}</p>}
      </div>
    );
  }

  return (
    <motion.div layout className="space-y-4" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wider text-ink-faint">ATLAS Connect</div>
          <div data-testid="connect-code" className="hash truncate text-sm text-ink" title="connection code (public; your browser holds the secret half)">{c.created.code}</div>
        </div>
        {!done && !expired && !failedHard && <CountdownRing left={left} total={c.created.ttlSeconds} />}
      </div>
      <ConnectStepper status={v?.status} stage={v?.stage} />

      <AnimatePresence mode="wait">
        {done ? (
          <motion.div key="done" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="grid place-items-center gap-3 py-6 text-center">
            <CommittedBadge label={purpose === "login" ? "Agent ID verified" : "Agentic Wallet available"} />
            <p className="text-sm text-ink-dim">{purpose === "login" ? (done.isNew ? "Account created. Let's set up your profile…" : `Welcome back, ${done.agentName}…`) : "Wallet checked for this session (10 minutes)."}</p>
          </motion.div>
        ) : expired || failedHard ? (
          <motion.div key="exp" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3 rounded-2xl border border-line bg-black/25 p-4 text-sm">
            <p className="flex items-center gap-2 text-ink"><AlertTriangle className="h-4 w-4 text-amber-300" />{expired ? "This code expired. Codes last 10 minutes and work once." : v?.status === "cancelled" ? "Cancelled." : "Too many failed attempts on this code."}</p>
            <Button className="w-full" onClick={async () => { await c.cancel(); await c.start(); }}><RotateCcw className="h-4 w-4" />Start again</Button>
          </motion.div>
        ) : v?.status === "approved" ? (
          <motion.div key="ok" data-testid="connect-approved" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-3 rounded-2xl border border-emerald-up/30 bg-emerald-up/5 p-4">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-full bg-emerald-up/15 text-lg font-semibold text-emerald-up">{v.agentName?.[0]?.toUpperCase()}</span>
              <div className="min-w-0"><div className="font-semibold">{v.agentName}</div><div className="hash break-all text-[11px] text-ink-dim">{v.wallet}</div></div>
            </div>
            <p className="text-xs text-ink-dim">ATLAS verified the signature and that this wallet owns the Agent ID NFT on BNB Smart Chain. Is this you?</p>
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <Button loading={c.busy} onClick={async () => { const r = await c.redeem(); if (r) { setDone(r); onDone(r); } }}>Continue as {v.agentName}</Button>
              <Button variant="ghost" onClick={c.cancel} aria-label="Not me, cancel"><X className="h-4 w-4" />Not me</Button>
            </div>
          </motion.div>
        ) : (
          <motion.div key="wait" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-3">
            {!compact && <HowItWorks />}
            <HandoffPanel code={c.created.code} handoff={c.created.handoff} purpose={purpose} />
            <StatusLine status={v?.status} stage={v?.stage} detail={v?.stageDetail} agentName={v?.agentName} />
            {isFallbackCode && (
              <div data-testid="connect-953004" className="rounded-xl border border-amber-300/30 bg-amber-300/5 p-3 text-xs text-ink-dim">
                Known upstream issue <a className="text-signal hover:underline" href={ISSUE_400} target="_blank" rel="noreferrer">binance-skills-hub#400 <ExternalLink className="inline h-3 w-3" /></a>: <span className="hash">baw sign-message preview</span> can fail with 953004 on EIP-712 logins. Use the on-chain proof instead (one zero-value call, no approvals).
                <Link href="/onboarding" className="mt-2 flex items-center gap-1 text-signal hover:underline">Open the on-chain fallback <ArrowRight className="h-3 w-3" /></Link>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      {c.error && !done && <p role="alert" className="text-sm text-coral-down">{c.error.message}</p>}
      {!done && !expired && !failedHard && <button onClick={c.cancel} className="text-xs text-ink-faint hover:text-ink">Cancel</button>}
    </motion.div>
  );
}

export function HonestStatus({ className }: { className?: string }) {
  return (
    <p className={cx("flex gap-2 text-[11px] leading-relaxed text-ink-faint", className)}>
      <Fingerprint className="h-3.5 w-3.5 shrink-0" />
      <span data-testid="connect-honest-status">Status: real Binance Agentic Wallet sign-in <b className="font-medium text-ink-dim">confirmed with baw 1.12.0 on Nov 19, 2026</b> (owner acceptance test, two signatures, no 953004). Upstream issue <a href={ISSUE_400} target="_blank" rel="noreferrer" className="text-signal hover:underline">#400</a> (953004 on EIP-712 preview) is still open but was not hit. If your wallet fails, use Advanced → on-chain proof.</span>
    </p>
  );
}
