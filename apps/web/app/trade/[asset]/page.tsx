"use client";
import { use, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "motion/react";
import { ArrowDownUp, ShieldAlert, CheckCircle2, Route, Receipt } from "lucide-react";
import { Card, Button, Badge, AnimatedNumber, Skeleton, cx } from "@atlas/design-system";
import { api, useSession } from "@/lib/api";
import { TxPanel } from "@/components/tx-panel";
import { RiskWarning } from "@/components/risk";
import { useToast } from "@/components/providers";

const TOKENS = ["BNB", "WBNB", "USDT", "USDC", "FDUSD", "BTCB", "ETH", "CAKE"];
const ASSET_TOKEN: Record<string, string> = { BNB: "BNB", BTC: "BTCB", ETH: "ETH", CAKE: "CAKE", USDC: "USDC" };

export default function Trade({ params }: { params: Promise<{ asset: string }> }) {
  const { asset } = use(params);
  const thesisId = useSearchParams().get("thesis") ?? undefined;
  const { authed } = useSession();
  const toast = useToast();
  const [tokenIn, setIn] = useState("USDT");
  const [tokenOut, setOut] = useState(ASSET_TOKEN[asset.toUpperCase()] ?? "BNB");
  const [amount, setAmount] = useState("10");
  const [slip, setSlip] = useState(50);
  const [q, setQ] = useState<any>(null);
  const [qErr, setQErr] = useState<string | null>(null);
  const [ack, setAck] = useState(false);
  const [prep, setPrep] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [txh, setTxh] = useState("");
  const [proof, setProof] = useState<any>(null);

  useEffect(() => {
    setPrep(null); setQErr(null);
    if (!/^\d+(\.\d+)?$/.test(amount) || Number(amount) <= 0 || tokenIn === tokenOut) { setQ(null); return; }
    const t = setTimeout(async () => {
      try { setQ(await api("/trade/quotes", { body: { tokenIn, tokenOut, amountIn: amount, slippageBps: slip, thesisId } })); }
      catch (e: any) { setQ(null); setQErr(e.message); }
    }, 350);
    return () => clearTimeout(t);
  }, [tokenIn, tokenOut, amount, slip, thesisId]);

  const prepare = async () => {
    setBusy(true);
    try { setPrep(await api("/trade/prepare", { body: { tokenIn, tokenOut, amountIn: amount, slippageBps: slip, thesisId, acknowledgeRisk: true } })); }
    catch (e: any) { toast({ kind: "err", text: e.message }); } finally { setBusy(false); }
  };

  return (
    <div className="mx-auto grid max-w-4xl gap-5 2xl:grid-cols-[1fr_320px]">
      <div className="space-y-4">
        <RiskWarning text={q?.riskDisclosure} />
        <Card hover={false} className="space-y-3 p-5">
          <div className="flex items-center justify-between"><h1 className="text-xl font-semibold">Swap on PancakeSwap V2</h1><Badge tone="signal">BSC mainnet · unsigned</Badge></div>
          {thesisId && <p className="text-xs text-ink-dim">Linked to <Link className="text-signal underline" href={`/thesis/${thesisId}`}>thesis</Link>. You choose your own size; nothing is copied from the author.</p>}
          <TokenRow label="You pay" token={tokenIn} setToken={setIn} amount={amount} setAmount={setAmount} />
          <div className="flex justify-center"><motion.button whileHover={{ rotate: 180 }} whileTap={{ scale: 0.9 }} transition={{ type: "spring", stiffness: 300, damping: 18 }} aria-label="Swap direction" onClick={() => { setIn(tokenOut); setOut(tokenIn); }} className="grid h-10 w-10 place-items-center rounded-xl border border-line bg-panel text-signal"><ArrowDownUp className="h-4 w-4" /></motion.button></div>
          <TokenRow label="You receive (estimated)" token={tokenOut} setToken={setOut} amount={q ? Number(q.expectedOut).toFixed(6) : ""} readOnly />
          <div className="flex items-center gap-2 text-xs text-ink-dim">Max slippage
            {[10, 50, 100, 300].map((s) => <button key={s} onClick={() => setSlip(s)} className={cx("num rounded-lg border px-2 py-1", slip === s ? "border-signal/50 bg-signal-dim text-ink" : "border-line")}>{(s / 100).toFixed(1)}%</button>)}
          </div>
          {qErr && <p className="text-sm text-coral-down">{qErr}</p>}
        </Card>
        <AnimatePresence>{prep && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-3">
            {prep.blocked ? <Card hover={false} className="p-5 text-coral-down"><ShieldAlert className="mr-2 inline h-4 w-4" />Blocked: {prep.warnings.join(" ")}</Card> : prep.steps.map((s: any, i: number) => (
              <Card key={i} hover={false} className="space-y-3 p-5">
                <div className="flex items-center gap-2"><Badge tone="signal">Step {i + 1}/{prep.steps.length}</Badge><span className="text-sm font-medium">{s.description}</span></div>
                <TxPanel prepared={{ ...s, transaction: s }} cta={i === prep.steps.length - 1 ? "Verify my swap" : "Step sent"} onSubmitted={async (h) => { setTxh(h); if (i === prep.steps.length - 1) await submitEvidence(h); }} />
              </Card>
            ))}
            {!prep.blocked && <p className="text-xs text-ink-faint">{prep.confirmation}</p>}
          </motion.div>
        )}</AnimatePresence>
        {authed && (
          <Card hover={false} className="space-y-3 p-5">
            <div className="label flex items-center gap-1.5"><Receipt className="h-3.5 w-3.5" />Submit execution evidence</div>
            <p className="text-xs text-ink-dim">Paste a BSC swap transaction sent from your Agent ID wallet. ATLAS verifies the sender, router and amounts from the receipt. A hash alone proves nothing.</p>
            <div className="flex gap-2"><input className="input hash" placeholder="0x… tx hash" value={txh} onChange={(e) => setTxh(e.target.value)} /><Button variant="outline" disabled={!/^0x[0-9a-fA-F]{64}$/.test(txh)} onClick={() => submitEvidence(txh)}>Verify</Button></div>
            <AnimatePresence>{proof && <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="rounded-xl border border-line bg-black/25 p-3 text-sm"><Badge tone={proof.proof.status === "VERIFIED" ? "up" : proof.proof.status === "PENDING" ? "warn" : "down"}>{proof.proof.status}</Badge> <span className="text-ink-dim">{proof.note}</span></motion.div>}</AnimatePresence>
          </Card>
        )}
      </div>

      <div className="space-y-4">
        <Card hover={false} className="space-y-3 p-5 2xl:sticky 2xl:top-6">
          <div className="label flex items-center gap-1.5"><Route className="h-3.5 w-3.5" />Quote</div>
          {!q ? <Skeleton className="h-32" /> : (<>
            <Row k="Route" v={q.route.join(" → ")} />
            <Row k="Expected" v={<><AnimatedNumber value={Number(q.expectedOut)} decimals={6} /> {q.tokenOut.symbol}</>} />
            <Row k="Minimum received" v={<span className="text-ink">{Number(q.minimumOut).toFixed(6)} {q.tokenOut.symbol}</span>} />
            <Row k="Price impact" v={<span className={q.priceImpactBps > 100 ? "text-amber-warn" : ""}>{(q.priceImpactBps / 100).toFixed(2)}%</span>} />
            <Row k="Slippage limit" v={`${(q.slippageBps / 100).toFixed(2)}%`} />
            <Row k="Router" v={<span className="hash">{q.router.slice(0, 10)}…</span>} />
            {q.warnings.map((w: string) => <p key={w} className="text-xs text-amber-warn">{w}</p>)}
          </>)}
          <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-line p-3 text-xs text-ink-dim">
            <input type="checkbox" className="mt-0.5 accent-[#46E1DF]" checked={ack} onChange={(e) => setAck(e.target.checked)} />
            I understand this is risky, I may lose money, nothing here is advice, and I will review and confirm the transaction in my own wallet.
          </label>
          {authed ? <Button className="w-full" disabled={!q || !ack || q.blocked} loading={busy} onClick={prepare}><CheckCircle2 className="h-4 w-4" />Prepare unsigned transaction</Button> : <Link href="/welcome"><Button className="w-full" variant="outline">Sign in to prepare</Button></Link>}
          <p className="text-[11px] text-ink-faint">Exact-amount approvals only; never unlimited. ATLAS cannot execute trades.</p>
        </Card>
      </div>
    </div>
  );

  async function submitEvidence(h: string) {
    try { setProof(await api("/trade/evidence", { body: { txHash: h, thesisId, share: true } })); }
    catch (e: any) { toast({ kind: "err", text: e.message }); }
  }
}

function TokenRow({ label, token, setToken, amount, setAmount, readOnly }: { label: string; token: string; setToken: (t: string) => void; amount: string; setAmount?: (a: string) => void; readOnly?: boolean }) {
  return (
    <div className="rounded-2xl border border-line bg-black/25 p-4">
      <div className="label">{label}</div>
      <div className="mt-2 flex items-center gap-3">
        <input aria-label={label} className="num w-full bg-transparent text-2xl font-semibold outline-none" inputMode="decimal" value={amount} readOnly={readOnly} onChange={(e) => setAmount?.(e.target.value.replace(/[^\d.]/g, ""))} placeholder="0.0" />
        <select aria-label={`${label} token`} className="rounded-xl border border-line bg-panel px-3 py-2 text-sm font-semibold" value={token} onChange={(e) => setToken(e.target.value)}>{TOKENS.map((t) => <option key={t}>{t}</option>)}</select>
      </div>
    </div>
  );
}
function Row({ k, v }: { k: string; v: React.ReactNode }) { return <div className="flex justify-between text-sm"><span className="text-ink-faint">{k}</span><span className="num text-ink-dim">{v}</span></div>; }
