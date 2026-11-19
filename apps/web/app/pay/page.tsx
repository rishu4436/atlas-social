"use client";
import * as React from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "motion/react";
import { ArrowUpRight, ArrowDownLeft, Receipt, HandCoins, ExternalLink, ShieldCheck, Plus, MessageSquare, FileText, User, TrendingUp } from "lucide-react";
import { Card, Badge, Button, Tabs, Skeleton, StaggerList, StaggerItem, cx } from "@atlas/design-system";
import { api, useApi, useSession, timeAgo } from "@/lib/api";
import { PayPendingNotice, usePayConfig } from "@/components/pay/shared";
import { PaymentRequestCard } from "@/components/pay/request-card";
import { RequestComposer } from "@/components/pay/request-composer";
import { useToast } from "@/components/providers";

type Tab = "all" | "sent" | "received" | "requests";

export default function PayPage() {
  const { authed, isLoading: sessionLoading } = useSession();
  const { cfg, pending } = usePayConfig();
  const [tab, setTab] = React.useState<Tab>("all");
  const rec = useApi<any>(authed && tab !== "requests" ? `/pay/receipts?direction=${tab}` : null, { refreshInterval: 10_000 });
  const reqs = useApi<any>(authed && tab === "requests" ? "/pay/requests" : null);
  const settings = useApi<any>(authed ? "/pay/settings" : null);
  const [compose, setCompose] = React.useState(false);
  const toast = useToast();
  if (!authed && sessionLoading) return <div className="mx-auto max-w-2xl space-y-3"><Skeleton className="h-36" /><Skeleton className="h-20" /></div>;
  if (!authed) return <Card className="mx-auto max-w-xl p-10 text-center text-ink-dim">Sign in with your Agent ID to see your payments.</Card>;
  const items = rec.data?.items;
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Card hover={false} className="relative overflow-hidden p-6">
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-signal/10 blur-3xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-semibold"><Receipt className="h-5 w-5 text-signal" />ATLAS Pay</h1>
            <p className="mt-1 max-w-md text-sm text-ink-dim">Pay people by their Agent ID instead of a wallet address. Receipts below are read from AtlasPay events on {cfg?.chain ?? "BNB Smart Chain"}; nothing is shown until the chain says it happened.</p>
          </div>
          <Button size="sm" onClick={() => setCompose(true)} data-testid="pay-new-request"><Plus className="h-4 w-4" />Request payment</Button>
        </div>
        <div className="relative mt-4 flex flex-wrap gap-1.5 text-xs">
          <Badge tone={pending ? "warn" : "up"} >{pending ? "AtlasPay pending deployment" : "AtlasPay live"}</Badge>
          <Badge>BNB · USDT</Badge>
          <Badge tone="signal"><ShieldCheck className="h-3 w-3" />Non-custodial</Badge>
          <Badge>Never affects Skill Score or points</Badge>
        </div>
      </Card>
      {pending && <PayPendingNotice />}
      <Tabs id="pay-tabs" value={tab} onChange={setTab} tabs={[{ value: "all", label: "All" }, { value: "sent", label: "Sent" }, { value: "received", label: "Received" }, { value: "requests", label: "Requests" }]} />
      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
          {tab === "requests" ? (
            !reqs.data ? <Skeleton className="h-32" /> : reqs.data.items.length === 0 ? <Empty text="No payment requests yet." /> :
              <StaggerList className="grid gap-3 sm:grid-cols-2">{reqs.data.items.map((r: any) => <StaggerItem key={r.id}><PaymentRequestCard id={r.id} compact /></StaggerItem>)}</StaggerList>
          ) : !items ? <div className="space-y-2"><Skeleton className="h-20" /><Skeleton className="h-20" /></div> : items.length === 0 ? <Empty text={pending ? "No receipts. AtlasPay is not deployed yet, so no ATLAS receipts can exist." : "No payments yet. Pay someone from their profile, a post or a DM."} /> : (
            <StaggerList className="space-y-2" >{items.map((x: any) => <StaggerItem key={x.id}><ReceiptRow x={x} /></StaggerItem>)}</StaggerList>
          )}
        </motion.div>
      </AnimatePresence>
      <Card hover={false} className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
        <div><div className="font-medium">Accept payments</div><div className="text-xs text-ink-dim">When off, nobody can start a payment or tip to you on ATLAS.</div></div>
        <button role="switch" aria-checked={settings.data?.acceptPayments ?? true} data-testid="pay-accept-toggle" onClick={async () => { const v = !(settings.data?.acceptPayments ?? true); await api("/pay/settings", { method: "PUT", body: { acceptPayments: v } }).then(() => settings.mutate()).catch((e) => toast({ kind: "err", text: e.message })); }}
          className={cx("relative h-7 w-12 rounded-full transition-colors", settings.data?.acceptPayments ?? true ? "bg-signal" : "bg-white/15")}>
          <motion.span layout className={cx("absolute top-1 h-5 w-5 rounded-full bg-white", settings.data?.acceptPayments ?? true ? "right-1" : "left-1")} />
        </button>
      </Card>
      <RequestComposer open={compose} onClose={() => { setCompose(false); reqs.mutate(); }} context={{ kind: "link" }} />
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <Card hover={false} className="grid place-items-center gap-3 p-10 text-center text-sm text-ink-dim"><HandCoins className="h-8 w-8 text-signal/70" />{text}</Card>;
}

const CTX_ICON: Record<string, any> = { post: FileText, thesis: TrendingUp, dm: MessageSquare, profile: User, request: HandCoins };

function ReceiptRow({ x }: { x: any }) {
  const out = x.direction === "sent";
  const other = out ? x.recipient : x.sender;
  const Icon = x.context ? CTX_ICON[x.context.kind] ?? User : null;
  const ctxHref = x.context?.kind === "post" ? null : x.context?.kind === "thesis" ? `/thesis/${x.context.id}` : x.context?.kind === "dm" ? "/messages" : x.context?.kind === "request" ? `/pay/r/${x.context.id}` : null;
  return (
    <Card className="flex items-center gap-3 p-4" data-testid="pay-receipt" data-status={x.status}>
      <span className={cx("grid h-10 w-10 shrink-0 place-items-center rounded-2xl", out ? "bg-coral-down/10 text-coral-down" : "bg-emerald-up/10 text-emerald-up")}>{out ? <ArrowUpRight className="h-5 w-5" /> : <ArrowDownLeft className="h-5 w-5" />}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-sm"><span className="text-ink-dim">{out ? "To" : "From"}</span>{other.agentName ? <Link href={`/u/${other.agentName}`} className="truncate font-medium hover:underline">{other.agentName}</Link> : <span className="hash truncate">{other.wallet}</span>}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-faint">
          <span>{timeAgo(x.blockTime)} ago</span>
          <span>· {x.kind === "tip" ? "Tip" : x.kind === "request" ? "Request" : "Direct"}</span>
          {Icon && (ctxHref ? <Link href={ctxHref} className="inline-flex items-center gap-1 hover:text-ink">· <Icon className="h-3 w-3" />{x.context.kind}</Link> : <span className="inline-flex items-center gap-1">· <Icon className="h-3 w-3" />{x.context.kind}</span>)}
          {x.memo && <span className="truncate">· “{x.memo}”</span>}
        </div>
      </div>
      <div className="text-right">
        <div className={cx("num font-semibold", out ? "text-ink" : "text-emerald-up")}>{out ? "−" : "+"}{x.amount} {x.asset}</div>
        <div className="mt-0.5 flex items-center justify-end gap-1.5 text-[11px]">
          <Badge tone={x.status === "final" ? "up" : "warn"}>{x.status}</Badge>
          {x.txUrl && <a href={x.txUrl} target="_blank" rel="noreferrer" aria-label="View transaction" className="text-ink-faint hover:text-ink"><ExternalLink className="h-3 w-3" /></a>}
        </div>
      </div>
    </Card>
  );
}
