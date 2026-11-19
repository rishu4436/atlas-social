"use client";
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { BadgeCheck, Wallet, ShieldCheck, Clock } from "lucide-react";
import { Badge, cx } from "@atlas/design-system";
import { short, timeAgo } from "@/lib/api";

function useNow() {
  const [n, setN] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => { const t = setInterval(() => setN(Math.floor(Date.now() / 1000)), 1000); return () => clearInterval(t); }, []);
  return n;
}

const VIA: Record<string, string> = { connect: "ATLAS Connect sign-in", "connect-step-up": "ATLAS Connect wallet check", signature: "pasted signature", onchain: "on-chain proof", "step-up": "pasted signature (step-up)" };

/**
 * The three separate states. A verified Agent ID (social identity) never implies the Agentic Wallet is
 * reachable right now, and neither implies any financial authorization.
 */
export function IdentityStates({ states, onCheckWallet, compact = false }: { states: any; onCheckWallet?: () => void; compact?: boolean }) {
  const now = useNow();
  if (!states) return null;
  const until = states.wallet.until as number | null;
  const live = !!until && until > now;
  const left = live ? until! - now : 0;
  const rows = [
    {
      icon: BadgeCheck, title: "Agent ID verified", tone: states.agentId.verified ? "up" : "neutral",
      badge: states.agentId.verified ? "verified" : "not verified",
      body: states.agentId.verified ? <><b className="text-ink">{states.agentId.agentName}</b> · <span className="hash break-all">{compact ? short(states.agentId.wallet, 6) : states.agentId.wallet}</span>{states.agentId.verifiedAt && <> · last proven {timeAgo(states.agentId.verifiedAt * 1000)} ago</>}</> : "Sign in with your Agent ID wallet.",
      note: "Your social identity on ATLAS. Followers, points and reputation belong to this Agent ID.",
    },
    {
      icon: Wallet, title: "Agentic Wallet available", tone: live ? "up" : "neutral",
      badge: live ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")} left` : "not checked now",
      body: live ? <>Checked via {VIA[states.wallet.via] ?? states.wallet.via ?? "wallet proof"} · this session only</> : <>No recent wallet check on this session{states.wallet.checkedAt ? <> (last {timeAgo(states.wallet.checkedAt * 1000)} ago)</> : null}. Being signed in does not mean your wallet is connected.</>,
      note: "A time-limited (10 min) proof that your wallet answered from a handoff. Needed for sensitive actions.",
    },
    {
      icon: ShieldCheck, title: "Financial actions", tone: "signal",
      badge: "per transaction", body: <>Every payment or contract call is previewed and approved in your own Agentic Wallet.</>,
      note: "ATLAS holds no standing authorization and never holds a wallet session.",
    },
  ] as const;
  return (
    <div className={cx("grid gap-2", compact ? "" : "sm:grid-cols-3")} data-testid="identity-states">
      {rows.map((r, i) => (
        <motion.div key={r.title} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }} className="rounded-2xl border border-line bg-black/25 p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-2 text-sm font-semibold"><r.icon className={cx("h-4 w-4", r.tone === "up" ? "text-emerald-up" : r.tone === "signal" ? "text-signal" : "text-ink-faint")} />{r.title}</span>
            <Badge tone={r.tone as any}>{r.title === "Agentic Wallet available" && live && <Clock className="h-3 w-3" />}{r.badge}</Badge>
          </div>
          <p className="mt-2 text-xs text-ink-dim">{r.body}</p>
          {!compact && <p className="mt-1 text-[11px] text-ink-faint">{r.note}</p>}
          {r.title === "Agentic Wallet available" && onCheckWallet && !live && <button onClick={onCheckWallet} className="mt-2 text-xs text-signal hover:underline">Check wallet now →</button>}
        </motion.div>
      ))}
    </div>
  );
}
