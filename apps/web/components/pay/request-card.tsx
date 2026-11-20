"use client";
import * as React from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { HandCoins, Clock, CheckCircle2, Ban, ExternalLink, Link2, Check, Loader2 } from "lucide-react";
import { Avatar, Badge, Button, Skeleton, cx } from "@atlas/design-system";
import { useApi, useSession, timeAgo } from "@/lib/api";
import { SendSheet } from "./send-sheet";

export const REQUEST_LINK = /\/pay\/r\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
export const requestIdIn = (text?: string | null) => (text ? REQUEST_LINK.exec(text)?.[1] ?? null : null);

const STATUS: Record<string, { tone: any; label: string; icon: any }> = {
  open: { tone: "signal", label: "Open", icon: Clock },
  // audit F4: a matching payment is broadcast or not final yet. Not paid, and Pay stays blocked.
  pending: { tone: "warn", label: "Payment pending", icon: Loader2 },
  paid: { tone: "up", label: "Paid", icon: CheckCircle2 },
  cancelled: { tone: "neutral", label: "Cancelled", icon: Ban },
  expired: { tone: "warn", label: "Expired", icon: Clock },
};

/** Payment request card for DMs, posts and the share page. Shows no wallet address: that is resolved only in the send sheet. */
export function PaymentRequestCard({ id, compact = false, onDark = false }: { id: string; compact?: boolean; onDark?: boolean }) {
  const { authed } = useSession();
  const q = useApi<any>(`/pay/requests/${id}`, { refreshInterval: 15_000 });
  const [open, setOpen] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  if (q.error) return <div className="rounded-2xl border border-line p-3 text-xs text-ink-faint">Payment request unavailable.</div>;
  if (!q.data) return <Skeleton className="h-28 rounded-2xl" />;
  const r = q.data; const st = STATUS[r.status] ?? STATUS.open!;
  return (
    <motion.div data-testid="pay-request-card" data-status={r.status} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
      className={cx("relative overflow-hidden rounded-2xl border p-4 text-left text-ink", onDark ? "border-white/10 bg-obsidian/90" : "border-signal/20 bg-gradient-to-br from-signal/[0.08] via-white/[0.02] to-transparent")}>
      <div aria-hidden className="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full bg-signal/10 blur-2xl" />
      <div className="flex items-center gap-2 text-xs text-ink-dim"><HandCoins className="h-4 w-4 text-signal" />Payment request
        <Badge tone={st.tone} className="ml-auto"><st.icon className="h-3 w-3" />{st.label}</Badge></div>
      <div className="mt-2 flex items-end justify-between gap-3">
        <div>
          <div className="num text-3xl font-semibold tracking-tight">{r.amount} <span className="text-base text-ink-dim">{r.asset}</span></div>
          <Link href={`/u/${r.requester.agentName}`} className="mt-1 flex items-center gap-1.5 text-xs text-ink-dim hover:text-ink"><Avatar name={r.requester.agentName} src={r.requester.avatarUrl} size={18} />to {r.requester.agentName}</Link>
        </div>
        {!compact && r.status === "open" && <span className="text-[11px] text-ink-faint">expires {new Date(r.expiresAt).toLocaleDateString()}</span>}
      </div>
      {r.note && <p className="mt-2 text-sm text-ink-dim">“{r.note}”</p>}
      {r.status === "paid" && r.paidTxUrl && <a href={r.paidTxUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-emerald-up hover:underline">Settled on-chain (final)<ExternalLink className="h-3 w-3" /></a>}
      {r.status === "pending" && r.pending && (
        <p data-testid="pay-request-pending" className="mt-2 text-xs text-amber-warn">
          {r.pending.note} Pay is paused until it is final or fails.{" "}
          {r.pending.txUrl && <a href={r.pending.txUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline">View tx<ExternalLink className="h-3 w-3" /></a>}
        </p>
      )}
      <div className="mt-3 flex items-center gap-2">
        {r.viewer?.canPay && <Button size="sm" onClick={() => setOpen(true)} data-testid="pay-request-pay"><HandCoins className="h-4 w-4" />Pay {r.amount} {r.asset}</Button>}
        {!authed && r.status === "open" && <Link href="/welcome"><Button size="sm" variant="outline">Sign in to pay</Button></Link>}
        {r.viewer?.isRequester && r.status === "open" && <span className="text-xs text-ink-faint">Waiting for payment · created {timeAgo(r.createdAt)} ago</span>}
        <button onClick={() => { void navigator.clipboard?.writeText(`${location.origin}${r.sharePath}`); setCopied(true); setTimeout(() => setCopied(false), 1400); }} aria-label="Copy request link" className="ml-auto rounded-lg p-1.5 text-ink-faint hover:bg-white/10 hover:text-ink">
          {copied ? <Check className="h-4 w-4 text-emerald-up" /> : <Link2 className="h-4 w-4" />}
        </button>
      </div>
      {r.contractsPending && r.status === "open" && <p className="mt-2 text-[11px] text-amber-warn">AtlasPay pending deployment: paying uses the official Agentic Wallet fallback.</p>}
      <SendSheet open={open} onClose={() => { setOpen(false); q.mutate(); }} recipient={{ userId: r.requester.userId, agentName: r.requester.agentName, displayName: r.requester.displayName, avatarUrl: r.requester.avatarUrl }}
        kind="request" locked={{ asset: r.asset, amount: r.amount, requestId: r.id, note: r.note }} />
    </motion.div>
  );
}
