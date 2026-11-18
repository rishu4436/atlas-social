"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import { Sparkles, TrendingUp, TrendingDown, AlertTriangle, CheckCircle2, ArrowRight, Eye, EyeOff } from "lucide-react";
import { Tabs, Card, Button, Badge, CommittedBadge, AnimatedNumber, cx } from "@atlas/design-system";
import { api, useApi, useSession, fmtPrice } from "@/lib/api";
import { TxPanel } from "@/components/tx-panel";
import { PriceChart } from "@/components/chart";
import { useToast } from "@/components/providers";

type Kind = "post" | "poll" | "thesis";
const ASSETS = ["BNB", "BTC", "ETH", "CAKE"];

export default function Compose() {
  const { authed } = useSession();
  const [kind, setKind] = useState<Kind>("thesis");
  if (!authed) return <Card className="mx-auto max-w-xl p-10 text-center"><p className="text-ink-dim">Sign in with your Agent ID to post.</p><Link href="/welcome"><Button className="mt-4">Sign in</Button></Link></Card>;
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold">Compose</h1>
      <Tabs id="compose" value={kind} onChange={setKind} tabs={[{ value: "post", label: "Post" }, { value: "poll", label: "Poll" }, { value: "thesis", label: "Trade Thesis" }]} />
      <AnimatePresence mode="wait">
        <motion.div key={kind} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
          {kind === "thesis" ? <ThesisComposer /> : <PostComposer kind={kind} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function PostComposer({ kind }: { kind: "post" | "poll" }) {
  const router = useRouter();
  const toast = useToast();
  const [body, setBody] = useState("");
  const [opts, setOpts] = useState(["", ""]);
  const [busy, setBusy] = useState(false);
  return (
    <Card hover={false} className="space-y-4 p-5">
      <textarea className="input min-h-36 resize-y text-[15px]" maxLength={5000} placeholder={kind === "poll" ? "Ask the community…" : "What are you seeing in the market? Use #topics and @name.ai"} value={body} onChange={(e) => setBody(e.target.value)} />
      {kind === "poll" && (
        <div className="space-y-2">
          {opts.map((o, i) => <input key={i} className="input" placeholder={`Option ${i + 1}`} value={o} onChange={(e) => setOpts(opts.map((x, j) => (j === i ? e.target.value : x)))} />)}
          {opts.length < 4 && <Button variant="ghost" size="sm" onClick={() => setOpts([...opts, ""])}>+ option</Button>}
        </div>
      )}
      <div className="flex items-center justify-between">
        <span className="num text-xs text-ink-faint">{body.length}/5000</span>
        <Button loading={busy} disabled={!body.trim() || (kind === "poll" && opts.filter((o) => o.trim()).length < 2)} onClick={async () => {
          setBusy(true);
          try {
            await api("/posts", { body: kind === "poll" ? { kind, body, poll: { options: opts.filter((o) => o.trim()), closesInHours: 24 } } : { kind, body } });
            toast({ kind: "ok", text: "Posted" }); router.push("/home");
          } catch (e: any) { toast({ kind: "err", text: e.message }); } finally { setBusy(false); }
        }}>Post</Button>
      </div>
    </Card>
  );
}

function ThesisComposer() {
  const toast = useToast();
  const [f, setF] = useState({ asset: "BNB", direction: "LONG" as "LONG" | "SHORT", entryKind: "MARKET", entryPrice: "", targetPrice: "", invalidationPrice: "", horizonHours: 72, confidence: 60, title: "", summary: "", body: "", visibility: "PUBLIC" });
  const mk = useApi<any>(`/markets/${f.asset}`, { refreshInterval: 15_000 });
  const hist = useApi<any>(`/markets/${f.asset}/history?interval=1h&limit=168`);
  const price = mk.data?.ticker?.lastPrice as number | undefined;
  const [stage, setStage] = useState<"edit" | "sign" | "done">("edit");
  const [draft, setDraft] = useState<any>(null);
  const [prep, setPrep] = useState<any>(null);
  const [ai, setAi] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: string, v: any) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    if (price && !f.targetPrice) {
      const dp = price > 100 ? 2 : 4;
      setF((x) => ({ ...x, targetPrice: (price * (x.direction === "LONG" ? 1.05 : 0.95)).toFixed(dp), invalidationPrice: (price * (x.direction === "LONG" ? 0.97 : 1.03)).toFixed(dp) }));
    }
  }, [price, f.targetPrice]);

  const rr = useMemo(() => {
    const e = f.entryKind === "MARKET" ? price : Number(f.entryPrice);
    const t = Number(f.targetPrice), i = Number(f.invalidationPrice);
    if (!e || !t || !i) return null;
    return { reward: Math.abs(t - e) / e, risk: Math.abs(e - i) / e, ratio: Math.abs(t - e) / Math.abs(e - i) };
  }, [f, price]);

  const input = () => ({ ...f, entryPrice: f.entryKind === "MARKET" ? undefined : f.entryPrice, horizonHours: Number(f.horizonHours), confidence: Number(f.confidence) });

  async function challenge() {
    setBusy(true); setErr(null);
    try { setAi(await api("/research/challenge", { body: { draft: { asset: f.asset, direction: f.direction, entryPrice: f.entryKind === "MARKET" ? null : Number(f.entryPrice), targetPrice: Number(f.targetPrice), invalidationPrice: Number(f.invalidationPrice), horizonHours: Number(f.horizonHours), confidence: Number(f.confidence), text: `${f.title}\n${f.summary}\n${f.body}` } } })); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  async function create() {
    setBusy(true); setErr(null);
    try {
      const d = await api("/theses", { body: input() });
      setDraft(d);
      setPrep(await api(`/theses/${d.thesis.id}/prepare`, { body: {} }));
      setStage("sign");
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  if (stage === "done" && draft) return (
    <Card hover={false} glow className="grid place-items-center gap-4 p-10 text-center">
      <CommittedBadge />
      <h2 className="text-xl font-semibold">{f.title}</h2>
      <p className="max-w-md text-sm text-ink-dim">Your terms are immutable on-chain. Corrections can be appended; the original stays visible forever, and the outcome will be scored by ATLAS-M1.</p>
      <Link href={`/thesis/${draft.thesis.id}`}><Button>View thesis<ArrowRight className="h-4 w-4" /></Button></Link>
    </Card>
  );

  if (stage === "sign" && prep) return (
    <Card hover={false} className="space-y-5 p-6">
      <div><h2 className="text-lg font-semibold">Publish on-chain</h2><p className="mt-1 text-sm text-ink-dim">{prep.summary}</p></div>
      <div className="flex gap-2 rounded-xl border border-amber-warn/20 bg-amber-warn/[0.05] p-3 text-xs text-amber-warn"><AlertTriangle className="h-4 w-4 shrink-0" />{prep.privacyWarning}</div>
      <TxPanel prepared={prep} cta="Confirm publication" onSubmitted={async (h) => { await api(`/theses/${draft.thesis.id}/confirm`, { body: { txHash: h } }); toast({ kind: "ok", text: "Thesis committed on-chain" }); setStage("done"); }} />
      <Button variant="ghost" size="sm" onClick={() => setStage("edit")}>← Back to draft</Button>
    </Card>
  );

  const long = f.direction === "LONG";
  return (
    <div className="space-y-4">
      <Card hover={false} className="space-y-5 p-5">
        <div className="flex flex-wrap items-center gap-2">
          {ASSETS.map((a) => <button key={a} onClick={() => setF((x) => ({ ...x, asset: a, targetPrice: "", invalidationPrice: "" }))} className={cx("rounded-xl border px-3 py-1.5 text-sm transition-colors", f.asset === a ? "border-signal/50 bg-signal-dim text-ink" : "border-line text-ink-dim hover:text-ink")}>{a}</button>)}
          <span className="ml-auto text-sm text-ink-dim">Now <AnimatedNumber value={price ?? 0} decimals={price && price > 100 ? 2 : 4} className="font-semibold text-ink" /></span>
        </div>
        <div className="-mx-1"><PriceChart candles={hist.data?.candles ?? []} height={180} levels={[...(Number(f.targetPrice) ? [{ price: Number(f.targetPrice), label: "Target", tone: "up" as const }] : []), ...(Number(f.invalidationPrice) ? [{ price: Number(f.invalidationPrice), label: "Invalid.", tone: "down" as const }] : [])]} /></div>
        <div className="grid grid-cols-2 gap-2">
          {(["LONG", "SHORT"] as const).map((d) => (
            <motion.button key={d} whileTap={{ scale: 0.97 }} onClick={() => setF((x) => ({ ...x, direction: d, targetPrice: "", invalidationPrice: "" }))}
              className={cx("flex items-center justify-center gap-2 rounded-2xl border py-3 font-semibold transition-colors", f.direction === d ? (d === "LONG" ? "border-emerald-up/50 bg-emerald-up/10 text-emerald-up" : "border-coral-down/50 bg-coral-down/10 text-coral-down") : "border-line text-ink-dim")}>
              {d === "LONG" ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}{d}
            </motion.button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div><label className="label">Entry</label><select className="input mt-1" value={f.entryKind} onChange={(e) => set("entryKind", e.target.value)}><option value="MARKET">At market</option><option value="AT_OR_BELOW">At or below</option><option value="AT_OR_ABOVE">At or above</option></select>{f.entryKind !== "MARKET" && <input className="input num mt-2" placeholder="price" value={f.entryPrice} onChange={(e) => set("entryPrice", e.target.value)} />}</div>
          <div><label className="label">Target ({long ? "≥" : "≤"})</label><input className="input num mt-1 text-emerald-up" value={f.targetPrice} onChange={(e) => set("targetPrice", e.target.value)} /></div>
          <div><label className="label">Invalidation ({long ? "≤" : "≥"})</label><input className="input num mt-1 text-coral-down" value={f.invalidationPrice} onChange={(e) => set("invalidationPrice", e.target.value)} /></div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label className="label">Horizon · <span className="num">{f.horizonHours}h</span></label><input type="range" min={6} max={720} step={6} value={f.horizonHours} onChange={(e) => set("horizonHours", Number(e.target.value))} className="mt-2 w-full accent-[#46E1DF]" /></div>
          <div><label className="label">Confidence · <span className="num">{f.confidence}%</span></label><input type="range" min={0} max={100} value={f.confidence} onChange={(e) => set("confidence", Number(e.target.value))} className="mt-2 w-full accent-[#46E1DF]" /></div>
        </div>
        {rr && (
          <div className="grid grid-cols-3 gap-2 text-center text-sm">
            <div className="rounded-xl bg-black/25 p-2"><div className="label">Reward</div><div className="num text-emerald-up">{(rr.reward * 100).toFixed(2)}%</div></div>
            <div className="rounded-xl bg-black/25 p-2"><div className="label">Risk</div><div className="num text-coral-down">{(rr.risk * 100).toFixed(2)}%</div></div>
            <div className="rounded-xl bg-black/25 p-2"><div className="label">R : R</div><div className={cx("num", rr.ratio >= 1 ? "text-ink" : "text-amber-warn")}>{rr.ratio.toFixed(2)}</div></div>
          </div>
        )}
        <input className="input" placeholder="Title" maxLength={140} value={f.title} onChange={(e) => set("title", e.target.value)} />
        <input className="input" placeholder="One-line summary (at least 10 characters)" maxLength={500} value={f.summary} onChange={(e) => set("summary", e.target.value)} />
        <textarea className="input min-h-28" placeholder="Supporting research (hashed into the on-chain commitment)" value={f.body} onChange={(e) => set("body", e.target.value)} />
        <div className="flex items-center gap-2">
          <button onClick={() => set("visibility", f.visibility === "PUBLIC" ? "COMMIT_REVEAL" : "PUBLIC")} className="inline-flex items-center gap-2 rounded-xl border border-line px-3 py-1.5 text-xs text-ink-dim hover:text-ink">
            {f.visibility === "PUBLIC" ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}{f.visibility === "PUBLIC" ? "Public terms" : "Commit now, reveal later"}
          </button>
          <span className="text-[11px] text-ink-faint">{f.visibility === "PUBLIC" ? "Terms are visible on publish." : "Only the hash is public until you reveal. Unrevealed theses are forfeited."}</span>
        </div>
        {err && <p role="alert" className="text-sm text-coral-down">{err}</p>}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button variant="outline" className="flex-1" loading={busy && !draft} onClick={challenge} disabled={!rr}><Sparkles className="h-4 w-4" />Challenge with AI</Button>
          <Button className="flex-1" loading={busy} onClick={create} disabled={!rr || f.title.length < 4 || f.summary.length < 10}>Review & publish<ArrowRight className="h-4 w-4" /></Button>
        </div>
      </Card>
      <AnimatePresence>
        {ai && (
          <Card hover={false} className="space-y-3 p-5" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <div className="flex items-center gap-2"><Badge tone="ai"><Sparkles className="h-3 w-3" />Thesis Challenger</Badge><span className="text-xs text-ink-faint">{ai.challenge.disclaimer}</span></div>
            <ul className="space-y-2 text-sm">{ai.challenge.findings.map((x: any, i: number) => <motion.li key={i} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-signal" /><span><b className="font-medium">{x.claim}</b><span className="block text-xs text-ink-faint">{x.evidence}</span></span></motion.li>)}</ul>
            <p className="text-xs text-ink-dim">{ai.challenge.uncertainty}</p>
          </Card>
        )}
      </AnimatePresence>
      <p className="text-center text-[11px] text-ink-faint">{fmtPrice(price ?? 0) && "Prices: Binance public spot API (reference). "}Theses are research, not financial advice.</p>
    </div>
  );
}
