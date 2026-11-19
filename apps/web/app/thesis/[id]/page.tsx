"use client";
import { use, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "motion/react";
import { ShieldCheck, Sparkles, ThumbsUp, ThumbsDown, Minus, History, Gauge, ArrowUpRight, Flag, AlertTriangle, HandCoins } from "lucide-react";
import { Card, Button, Badge, CommittedBadge, Skeleton, StaggerList, StaggerItem, AnimatedNumber, Tabs, cx } from "@atlas/design-system";
import { api, useApi, useSession, timeAgo, short, fmtPrice } from "@/lib/api";
import { AuthorLine } from "@/components/post-card";
import { PriceChart } from "@/components/chart";
import { TxPanel } from "@/components/tx-panel";
import { RiskWarning } from "@/components/risk";
import { useToast } from "@/components/providers";
import { SendSheet } from "@/components/pay/send-sheet";
import { ResearchThread } from "@/components/agents/thread";

const OUTCOME_TONE: Record<string, any> = { TargetHit: "up", InvalidationHit: "down", Expired: "down", Forfeited: "down", Unresolved: "warn", Void: "neutral", Open: "signal" };

export default function ThesisPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { session, authed } = useSession();
  const toast = useToast();
  const t = useApi<any>(`/theses/${id}`, { refreshInterval: 30_000 });
  const hist = useApi<any>(t.data ? `/markets/${t.data.asset}/history?interval=1h&limit=240` : null);
  const rv = useApi<any>(`/theses/${id}/reviews`);
  const [ev, setEv] = useState<any>(null);
  const [ai, setAi] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<"reviews" | "thread" | "corrections" | "ai">("reviews");

  if (t.error) return <Card className="p-10 text-center text-ink-dim">Thesis not found or not visible to you.</Card>;
  if (!t.data) return <div className="space-y-4"><Skeleton className="h-10 w-2/3" /><Skeleton className="h-72" /><Skeleton className="h-40" /></div>;
  const d = t.data;
  const mine = session?.userId === d.authorId;
  const onchain = d.chainStatus === "published" || d.chainStatus === "committed";
  const long = d.direction === "LONG";
  const levels = [
    ...(d.targetPrice ? [{ price: Number(d.targetPrice), label: "Target", tone: "up" as const }] : []),
    ...(d.invalidationPrice ? [{ price: Number(d.invalidationPrice), label: "Invalidation", tone: "down" as const }] : []),
    ...(d.entryPrice ? [{ price: Number(d.entryPrice), label: "Entry", tone: "signal" as const }] : []),
  ];
  const run = async (k: string, fn: () => Promise<void>) => { setBusy(k); try { await fn(); } catch (e: any) { toast({ kind: "err", text: e.message }); } finally { setBusy(null); } };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Card hover={false} glow={onchain} className="space-y-5 p-6">
        <div className="flex items-start justify-between gap-3"><AuthorLine a={d.author} at={d.publishedAt ?? d.createdAt} agent={d.agent} />{onchain ? <CommittedBadge /> : <Badge tone="warn">{d.badge}</Badge>}</div>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={long ? "up" : "down"}>{d.direction} {d.asset}</Badge>
            <Badge tone={OUTCOME_TONE[d.outcome] ?? "neutral"}>{d.outcome}</Badge>
            <span className="text-xs text-ink-faint">{d.horizonHours}h horizon · confidence {d.confidence}%</span>
          </div>
          {d.scoring?.status === "unscorable" && (
            <div role="status" data-testid="unscorable" className="mt-3 flex gap-2 rounded-xl border border-amber-warn/25 bg-amber-warn/[0.06] p-3 text-xs text-amber-warn">
              <AlertTriangle className="h-4 w-4 shrink-0" /><span><b className="font-medium">Cannot be scored right now.</b> {d.scoring.note} Prices are never simulated; after the deadline this thesis is Unresolved.</span>
            </div>
          )}
          {d.scoring?.source && <p className="mt-2 text-[11px] text-ink-faint">Outcome price source: <span className="hash">{d.scoring.source}</span> (real exchange data, recorded in the evidence)</p>}
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">{d.content?.title ?? "Committed thesis (terms hidden until reveal)"}</h1>
          {d.content?.summary && <p className="mt-2 text-ink-dim">{d.content.summary}</p>}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            ["Now", d.market?.lastPrice, "text-ink"],
            ["Entry", d.entryPrice ? Number(d.entryPrice) : null, "text-signal"],
            ["Target", d.targetPrice ? Number(d.targetPrice) : null, "text-emerald-up"],
            ["Invalidation", d.invalidationPrice ? Number(d.invalidationPrice) : null, "text-coral-down"],
          ].map(([l, v, c]: any) => (
            <div key={l} className="rounded-2xl bg-black/25 p-3"><div className="label">{l}</div><div className={cx("num mt-1 text-lg font-semibold", c)}>{v == null ? (l === "Entry" ? "Market" : "—") : <AnimatedNumber value={v} decimals={v > 100 ? 2 : 4} />}</div></div>
          ))}
        </div>
        <PriceChart candles={hist.data?.candles ?? []} levels={levels} height={260} />
        {d.content?.body && <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-ink/90">{d.content.body}</p>}
        <div className="flex flex-wrap gap-2">
          <Link href={`/proof/${d.id}`}><Button variant="outline" size="sm"><ShieldCheck className="h-4 w-4" />Verify proofs</Button></Link>
          {d.chainStatus === "published" && <Button variant="outline" size="sm" loading={busy === "ev"} onClick={() => run("ev", async () => setEv(await api(`/theses/${d.id}/evaluate`, { body: {} })))}><Gauge className="h-4 w-4" />Evaluate now</Button>}
          {session?.authenticated && !mine && (d.chainStatus === "published" || d.chainStatus === "committed") && <TipThesis d={d} />}
          <Link href={`/trade/${d.asset}?thesis=${d.id}`}><Button variant="ghost" size="sm">Prepare my own trade<ArrowUpRight className="h-4 w-4" /></Button></Link>
          {d.publishTxUrl && <a href={d.publishTxUrl} target="_blank" rel="noreferrer"><Button variant="ghost" size="sm">Explorer<ArrowUpRight className="h-4 w-4" /></Button></a>}
        </div>
        <AnimatePresence>{ev && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="rounded-2xl border border-line bg-black/25 p-4 text-sm">
            <div className="flex items-center gap-2"><Badge tone={OUTCOME_TONE[ev.result?.outcome] ?? "neutral"}>{ev.result?.outcome ?? ev.outcome}</Badge><span className="text-ink-faint">Dry run · not written on-chain{ev.evidence?.source ? ` · source ${ev.evidence.source}` : ""}</span></div>
            {ev.scorable === false && <p className="mt-2 text-xs text-amber-warn">{ev.reason}</p>}
            <pre className="hash mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-[11px] text-ink-dim">{JSON.stringify(ev.result ?? ev, null, 2)}</pre>
          </motion.div>
        )}</AnimatePresence>
        <div className="grid gap-1 text-[11px] text-ink-faint">
          <span>Commitment <span className="hash text-ink-dim">{short(d.commitment, 10)}</span> · registry <span className="hash">{short(d.registry)}</span> · chain {d.chainId}</span>
          <span>Outcome describes whether published conditions were met. It is not realized profit. Execution evidence is separate.</span>
        </div>
      </Card>

      {mine && <AuthorActions d={d} onChange={() => t.mutate()} />}

      <Tabs id="thesis-tabs" value={tab} onChange={setTab} tabs={[{ value: "reviews", label: `Reviews ${rv.data ? `(${rv.data.reviews.length})` : ""}` }, { value: "thread", label: "Research thread" }, { value: "corrections", label: `Corrections (${d.corrections.length})` }, { value: "ai", label: "AI challenge" }]} />
      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
          {tab === "reviews" && <Reviews d={d} rv={rv} canReview={authed && !mine && onchain} />}
          {tab === "thread" && <ResearchThread thesisId={d.id} canVerify={authed && !mine && d.chainStatus !== "draft"} />}
          {tab === "corrections" && (
            <Card hover={false} className="p-5">
              {d.corrections.length === 0 ? <p className="text-sm text-ink-dim">No corrections. Original terms stand.</p> : (
                <StaggerList className="space-y-3">{d.corrections.map((c: any, i: number) => (
                  <StaggerItem key={c.id} className="flex gap-3"><History className="mt-0.5 h-4 w-4 text-signal" /><div><p className="text-sm">{c.note}</p><p className="text-[11px] text-ink-faint">#{i + 1} · {timeAgo(c.created_at)} · {c.tx_hash ? <span className="hash">{short(c.tx_hash)}</span> : "pending on-chain"}</p></div></StaggerItem>
                ))}</StaggerList>
              )}
              <p className="mt-4 text-[11px] text-ink-faint">Corrections are append-only. The original commitment is never edited.</p>
            </Card>
          )}
          {tab === "ai" && (
            <Card hover={false} className="space-y-3 p-5">
              {!ai ? <Button variant="outline" loading={busy === "ai"} onClick={() => run("ai", async () => setAi(await api("/research/challenge", { body: { thesisId: d.id } })))}><Sparkles className="h-4 w-4" />Run Thesis Challenger + Risk Analyst</Button> : (
                <StaggerList className="space-y-3">
                  {[ai.challenge, ai.risk].filter(Boolean).map((r: any) => (
                    <StaggerItem key={r.agent} className="space-y-2">
                      <Badge tone="ai"><Sparkles className="h-3 w-3" />{r.agent}</Badge>
                      <ul className="space-y-1.5 text-sm">{r.findings.map((f: any, i: number) => <li key={i}><b className="font-medium">{f.claim}</b> <span className="text-ink-faint">— {f.evidence}</span></li>)}</ul>
                      <p className="text-xs text-ink-faint">{r.uncertainty}</p>
                    </StaggerItem>
                  ))}
                  <p className="text-[11px] text-ink-faint">{ai.challenge?.disclaimer}</p>
                </StaggerList>
              )}
            </Card>
          )}
        </motion.div>
      </AnimatePresence>
      <RiskWarning />
    </div>
  );
}

function Reviews({ d, rv, canReview }: { d: any; rv: any; canReview: boolean }) {
  const toast = useToast();
  const [stance, setStance] = useState<"ENDORSE" | "DISPUTE" | "NEUTRAL">("ENDORSE");
  const [body, setBody] = useState("");
  const [tx, setTx] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const icons = { ENDORSE: ThumbsUp, DISPUTE: ThumbsDown, NEUTRAL: Minus };
  return (
    <div className="space-y-3">
      {canReview && !tx && (
        <Card hover={false} className="space-y-3 p-4">
          <div className="flex gap-2">{(Object.keys(icons) as (keyof typeof icons)[]).map((s) => { const I = icons[s]; return (
            <motion.button key={s} whileTap={{ scale: 0.95 }} onClick={() => setStance(s)} className={cx("flex flex-1 items-center justify-center gap-1.5 rounded-xl border py-2 text-xs font-medium", stance === s ? "border-signal/50 bg-signal-dim text-ink" : "border-line text-ink-dim")}><I className="h-3.5 w-3.5" />{s.toLowerCase()}</motion.button>); })}</div>
          <textarea className="input min-h-20" placeholder="Your review (hashed on-chain with your stance)" value={body} onChange={(e) => setBody(e.target.value)} />
          <Button size="sm" loading={busy} disabled={!body.trim()} onClick={async () => { setBusy(true); try { const r = await api(`/theses/${d.id}/reviews`, { body: { stance, body } }); rv.mutate(); if (r.onchain) setTx(r.onchain); else toast({ kind: "ok", text: "Review saved" }); } catch (e: any) { toast({ kind: "err", text: e.message }); } finally { setBusy(false); } }}>Publish review</Button>
        </Card>
      )}
      {tx && <Card hover={false} className="p-4"><p className="mb-3 text-sm text-ink-dim">Anchor your review on-chain (optional, no funds moved):</p><TxPanel prepared={tx} cta="Confirm review" onSubmitted={async (h) => { await api(`/theses/${d.id}/reviews/confirm`, { body: { txHash: h } }); setTx(null); rv.mutate(); toast({ kind: "ok", text: "Review anchored on-chain" }); }} /></Card>}
      {!rv.data ? <Skeleton className="h-24" /> : rv.data.reviews.length === 0 ? <Card hover={false} className="p-5 text-sm text-ink-dim">No reviews yet.</Card> : (
        <StaggerList className="space-y-3">{rv.data.reviews.map((r: any) => (
          <StaggerItem key={r.id}><Card className="space-y-2 p-4">
            <div className="flex items-center justify-between"><AuthorLine a={r.reviewer} at={r.createdAt} agent={r.agent} /><Badge tone={r.stance === "ENDORSE" ? "up" : r.stance === "DISPUTE" ? "down" : "neutral"}>{r.stance}</Badge></div>
            <p className="text-sm">{r.body}</p>
            <p className="text-[11px] text-ink-faint">{r.onchain ? <>On-chain · <span className="hash">{short(r.txHash)}</span></> : "Off-chain"}</p>
          </Card></StaggerItem>
        ))}</StaggerList>
      )}
      {rv.data?.challenges?.length > 0 && <Card hover={false} className="p-4"><div className="label mb-2"><Flag className="mr-1 inline h-3 w-3" />Evidence challenges</div>{rv.data.challenges.map((c: any) => <p key={c.id} className="text-sm">{c.kind}: {c.reason} <span className="text-ink-faint">— {c.challenger}</span></p>)}</Card>}
    </div>
  );
}

function AuthorActions({ d, onChange }: { d: any; onChange: () => void }) {
  const toast = useToast();
  const [tx, setTx] = useState<{ prepared: any; kind: string } | null>(null);
  const [note, setNote] = useState("");
  const go = async (path: string, kind: string, body: any = {}) => { try { const r = await api(path, { body }); if (r.transaction) setTx({ prepared: r, kind }); else { toast({ kind: "ok", text: r.note ?? "Done" }); onChange(); } } catch (e: any) { toast({ kind: "err", text: e.message }); } };
  return (
    <Card hover={false} className="space-y-3 p-5">
      <div className="label">Author actions</div>
      {d.agent && d.chainStatus === "draft" && (
        <div data-testid="agent-draft-notice" className="rounded-xl border border-violet-400/30 bg-violet-500/10 p-3 text-xs text-violet-100">
          Drafted by your AI agent <b>{d.agent.agentName}</b> ({d.agent.model || "model undeclared"}). Nothing is published until you review the terms and confirm the transaction in your own wallet. Once on-chain it is permanent, labelled agent-authored and scored only on the AI Analysts board.
        </div>
      )}
      {!tx ? (<>
        <div className="flex flex-wrap gap-2">
          {d.chainStatus === "draft" && <Button size="sm" onClick={() => go(`/theses/${d.id}/prepare`, "publish")}>Publish on-chain</Button>}
          {d.chainStatus === "committed" && <Button size="sm" onClick={() => go(`/theses/${d.id}/reveal`, "reveal")}>Reveal terms</Button>}
          {d.chainStatus !== "cancelled" && <Button size="sm" variant="danger" onClick={() => go(`/theses/${d.id}/cancel`, "cancel")}>{d.chainStatus === "draft" ? "Discard draft" : "Cancel (counts as loss)"}</Button>}
        </div>
        {d.chainStatus === "published" && (
          <div className="flex gap-2"><input className="input" placeholder="Append a correction (original stays visible)" value={note} onChange={(e) => setNote(e.target.value)} /><Button size="sm" variant="outline" disabled={note.length < 3} onClick={() => go(`/theses/${d.id}/corrections`, "correction", { note })}>Append</Button></div>
        )}
      </>) : <TxPanel prepared={tx.prepared} cta={`Confirm ${tx.kind}`} onSubmitted={async (h) => { await api(`/theses/${d.id}/confirm`, { body: { txHash: h } }); setTx(null); onChange(); toast({ kind: "ok", text: `${tx.kind} submitted` }); }} />}
    </Card>
  );
}

function TipThesis({ d }: { d: any }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} data-testid="thesis-tip"><HandCoins className="h-4 w-4" />Tip author</Button>
      <SendSheet open={open} onClose={() => setOpen(false)} recipient={{ userId: d.authorId, agentName: d.author.agentName, displayName: d.author.displayName, avatarUrl: d.author.avatarUrl }} kind="tip" context={{ kind: "thesis", id: d.id }} />
    </>
  );
}
