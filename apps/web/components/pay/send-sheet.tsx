"use client";
import * as React from "react";
import { motion, AnimatePresence } from "motion/react";
import { ArrowRight, ArrowLeft, Wallet, ShieldCheck, Fuel, Network, Receipt, CheckCircle2, ExternalLink, AlertTriangle, Lock, Terminal } from "lucide-react";
import { Avatar, Badge, Button, Skeleton, cx } from "@atlas/design-system";
import { isPayAmount } from "@atlas/auth/pay";
import { api, ApiError, timeAgo } from "@/lib/api";
import { CommandBlock, LiveDot, SafetyNote } from "@/components/onboarding/parts";
import { CopyBlock } from "@/components/tx-panel";
import { Sheet, StepDots, FullAddress, AssetToggle, PayPendingNotice, usePayConfig, kindLabel, type PayAsset, type PayRecipient } from "./shared";
import { BawFallback } from "./baw-fallback";

export interface SendSheetProps {
  open: boolean;
  onClose: () => void;
  recipient: PayRecipient;
  kind?: "direct" | "tip" | "request";
  context?: { kind: "profile" | "post" | "thesis" | "dm" | "request"; id?: string };
  /** request payments lock asset + amount */
  locked?: { asset: PayAsset; amount: string; requestId: string; note?: string };
}

type Step = "amount" | "review" | "authorize" | "tracking" | "fallback";
const QUICK: Record<PayAsset, string[]> = { BNB: ["0.01", "0.05", "0.1"], USDT: ["1", "5", "20"] };

export function SendSheet(props: SendSheetProps) {
  return (
    <Sheet open={props.open} onClose={props.onClose} label={`Pay ${props.recipient.agentName}`} testId="send-sheet">
      {props.open && <SendFlow {...props} />}
    </Sheet>
  );
}

function SendFlow({ recipient, kind = "direct", context = { kind: "profile" }, locked, onClose }: SendSheetProps) {
  const { cfg, pending } = usePayConfig();
  const [step, setStep] = React.useState<Step>("amount");
  const [asset, setAsset] = React.useState<PayAsset>(locked?.asset ?? "BNB");
  const [amount, setAmount] = React.useState(locked?.amount ?? "");
  const [memo, setMemo] = React.useState("");
  const [resolved, setResolved] = React.useState<any>(null);
  const [prepared, setPrepared] = React.useState<any>(null);
  const [err, setErr] = React.useState<{ code?: string; message: string; details?: any } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [txHash, setTxHash] = React.useState("");
  const valid = isPayAmount(amount);
  const ctx = locked ? { kind: "request" as const, id: locked.requestId } : context;
  const k = locked ? "request" : kind;
  const steps = ["Amount", "Review", "Authorize", "Receipt"];
  const at = step === "amount" ? 0 : step === "review" || step === "fallback" ? 1 : step === "authorize" ? 2 : 3;

  async function review() {
    setBusy(true); setErr(null); setPrepared(null); setResolved(null);
    let got = false;
    try {
      const r = await api("/pay/recipient", { body: { recipientUserId: recipient.userId } });
      setResolved(r); got = true;
      setStep("review");
      if (!pending) {
        const p = await api("/pay/prepare", { body: { recipientUserId: recipient.userId, expectedRecipient: r.address, asset, amount, kind: k, context: ctx, memo } });
        setPrepared(p);
      }
    } catch (e) {
      const x = e as ApiError;
      setErr({ code: x.code, message: x.message, details: x.details });
      setStep(got ? "review" : "amount");
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-5">
      <header className="space-y-3 pr-8">
        <StepDots steps={steps} at={at} />
        <div className="flex items-center gap-3">
          <Avatar name={recipient.agentName} src={recipient.avatarUrl} size={44} />
          <div className="min-w-0">
            <div className="text-xs text-ink-faint">{kindLabel(k, ctx.kind)} to</div>
            <div className="truncate font-semibold" data-testid="pay-recipient-name">{recipient.agentName}</div>
            {recipient.displayName && <div className="truncate text-xs text-ink-dim">{recipient.displayName}</div>}
          </div>
          <Badge className="ml-auto shrink-0"><Network className="h-3 w-3" />{cfg?.chain ?? "BNB Smart Chain"}</Badge>
        </div>
      </header>

      <AnimatePresence mode="wait" initial={false}>
        {step === "amount" && (
          <motion.section key="amount" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} className="space-y-4">
            {pending && <PayPendingNotice />}
            <div className="flex items-center justify-between gap-3">
              <AssetToggle value={asset} onChange={(a) => { setAsset(a); if (!locked) setAmount(""); }} disabled={!!locked} />
              {asset === "USDT" && cfg?.assets?.[1]?.isMock && <Badge tone="warn">local mock USDT</Badge>}
            </div>
            <div className="rounded-3xl border border-line bg-gradient-to-br from-signal/[0.07] via-transparent to-transparent p-5 text-center">
              <label htmlFor="pay-amount" className="label">Amount</label>
              <div className="mt-1 flex items-baseline justify-center gap-2">
                <input id="pay-amount" data-testid="pay-amount" inputMode="decimal" autoComplete="off" value={amount} readOnly={!!locked}
                  onChange={(e) => setAmount(e.target.value.replace(",", ".").replace(/[^0-9.]/g, ""))} placeholder="0.00"
                  className="num w-full min-w-0 bg-transparent text-center text-5xl font-semibold tracking-tight outline-none placeholder:text-ink-faint/50" style={{ maxWidth: `${Math.max(4, amount.length + 1)}ch` }} />
                <span className="text-xl font-medium text-ink-dim">{asset}</span>
              </div>
              {!locked && <div className="mt-3 flex justify-center gap-2">{QUICK[asset].map((q) => <button key={q} onClick={() => setAmount(q)} className={cx("rounded-full border px-3 py-1 text-xs", amount === q ? "border-signal/50 text-signal" : "border-line text-ink-dim hover:text-ink")}>{q}</button>)}</div>}
              {amount && !valid && <p className="mt-2 text-xs text-coral-down">Enter a positive amount (up to 18 decimals).</p>}
            </div>
            {locked?.note && <p className="rounded-xl bg-white/[0.03] p-3 text-sm text-ink-dim">“{locked.note}”</p>}
            {!locked && (
              <div>
                <label htmlFor="pay-memo" className="label">Note for {recipient.agentName} (optional)</label>
                <input id="pay-memo" className="input mt-1" maxLength={140} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Only you two see this. Its hash goes on-chain, never the text." />
              </div>
            )}
            {k === "tip" && <p className="text-xs text-ink-faint">Tips are voluntary and never change Skill Score, Arena rank or points.</p>}
            {err && <ErrLine err={err} />}
            <Button className="w-full" size="lg" disabled={!valid} loading={busy} onClick={review} data-testid="pay-review">Review payment<ArrowRight className="h-4 w-4" /></Button>
          </motion.section>
        )}

        {step === "review" && (
          <motion.section key="review" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} className="space-y-4">
            <div className="text-center">
              <div className="num text-4xl font-semibold tracking-tight" data-testid="pay-review-amount">{amount} <span className="text-xl text-ink-dim">{asset}</span></div>
              <div className="mt-1 text-xs text-ink-faint">{kindLabel(k, ctx.kind)}</div>
            </div>
            <div className="divide-y divide-line rounded-2xl border border-line bg-white/[0.02]">
              <Row label="To"><span className="font-medium">{recipient.agentName}</span></Row>
              <Row label="Network"><span>{resolved?.network?.name} · {resolved?.network?.chainId}</span></Row>
              <div className="space-y-1.5 p-3.5">
                <div className="flex items-center justify-between text-xs text-ink-faint"><span>Destination (Agent ID owner)</span>
                  <span className="flex items-center gap-1"><LiveDot />read {resolved ? timeAgo(resolved.resolvedAt) : ""} ago</span></div>
                {resolved ? <FullAddress address={resolved.address} testId="pay-destination" /> : <Skeleton className="h-5" />}
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {resolved && <Badge tone={resolved.addressType === "EOA" ? "up" : "warn"}>{resolved.addressType}</Badge>}
                  <Badge tone="signal"><Lock className="h-3 w-3" />re-checked at execution</Badge>
                </div>
                {resolved?.addressType && resolved.addressType !== "EOA" && <p className="text-xs text-amber-warn">⚠️ This Agent ID is held by {resolved.addressType === "CONTRACT" ? "a smart contract" : "an address ATLAS could not classify"}. Funds sent to a contract may not be recoverable.</p>}
              </div>
              {!pending && (
                <Row label={<span className="inline-flex items-center gap-1"><Fuel className="h-3.5 w-3.5" />Network fee</span>}>
                  {prepared ? <span data-testid="pay-gas">{prepared.gasEstimate.feeBnb ? `≈ ${Number(prepared.gasEstimate.feeBnb).toPrecision(3)} BNB` : `≈ ${Number(prepared.gasEstimate.gas).toLocaleString()} gas`}{!prepared.gasEstimate.estimated && <span className="text-ink-faint"> · approx</span>}</span> : <Skeleton className="h-4 w-24" />}
                </Row>
              )}
              {prepared && <Row label="Wallet steps"><span>{prepared.steps.length === 2 ? "Approve exact amount, then pay" : "One transaction"}</span></Row>}
            </div>
            <p className="text-xs leading-relaxed text-ink-dim">AtlasPay reads {recipient.agentName}&apos;s owner again when your transaction executes. If it no longer matches the address above, the payment reverts and nothing moves.</p>
            {pending ? (
              <>
                <PayPendingNotice />
                <Button className="w-full" size="lg" onClick={() => setStep("fallback")} data-testid="pay-use-fallback"><Terminal className="h-4 w-4" />Use the Agentic Wallet fallback</Button>
              </>
            ) : (
              <>
                {err && <ErrLine err={err} onRetry={review} />}
                <Button className="w-full" size="lg" disabled={!prepared} loading={busy} onClick={() => setStep("authorize")} data-testid="pay-authorize"><Wallet className="h-4 w-4" />Authorize in Agentic Wallet</Button>
              </>
            )}
            <button onClick={() => { setStep("amount"); setErr(null); }} className="mx-auto flex items-center gap-1 text-xs text-ink-dim hover:text-ink"><ArrowLeft className="h-3.5 w-3.5" />Edit amount</button>
          </motion.section>
        )}

        {step === "authorize" && prepared && (
          <motion.section key="authorize" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} className="space-y-3">
            <SafetyNote>ATLAS built these transactions but <b className="text-ink">cannot sign or send them</b>. Run each step in your own Agentic Wallet, check the preview (recipient {prepared.recipient.address.slice(0, 8)}…{prepared.recipient.address.slice(-6)}, {amount} {asset}), and execute only if it matches.</SafetyNote>
            {prepared.steps.map((s: any, i: number) => (
              <div key={i} className="space-y-2">
                <CommandBlock n={`${i + 1}a`} title={i === 0 && prepared.steps.length === 2 ? `Preview: approve exactly ${amount} USDT` : `Preview: pay ${amount} ${asset}`} cmd={s.baw.preview} testId={`pay-step-${i}`}
                  why={s.description} check={<>Check that the call goes to {i === 0 && prepared.steps.length === 2 ? "the USDT contract" : "AtlasPay"}, value is {s.value === "0" ? "0" : `${amount} BNB`}, and the simulation shows the transfer to {recipient.agentName}. {s.baw.note}</>} />
                <CommandBlock n={`${i + 1}b`} title="Execute after reviewing the preview" cmd={s.baw.execute} placeholder />
              </div>
            ))}
            {typeof window !== "undefined" && (window as any).ethereum && <BrowserWalletSend steps={prepared.steps} onHash={setTxHash} />}
            <div className="space-y-2 pt-1">
              <label className="label" htmlFor="pay-tx">Payment transaction hash</label>
              <input id="pay-tx" data-testid="pay-txhash" className="input hash" placeholder="0x…" value={txHash} onChange={(e) => setTxHash(e.target.value.trim())} />
              <Button className="w-full" disabled={!/^0x[0-9a-fA-F]{64}$/.test(txHash)} onClick={() => setStep("tracking")} data-testid="pay-track"><Receipt className="h-4 w-4" />Track receipt</Button>
            </div>
            <details className="text-xs text-ink-dim"><summary className="cursor-pointer">Raw transactions</summary><div className="mt-2"><CopyBlock text={JSON.stringify(prepared.steps.map(({ baw: _b, gas: _g, ...s }: any) => s), null, 2)} /></div></details>
          </motion.section>
        )}

        {step === "tracking" && (
          <motion.section key="tracking" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }}>
            <ReceiptTracker txHash={txHash} onDone={onClose} />
          </motion.section>
        )}

        {step === "fallback" && (
          <motion.section key="fallback" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} className="space-y-3">
            <BawFallback recipient={recipient} asset={asset} amount={amount} atlasAddress={resolved?.address} />
            <button onClick={() => setStep("review")} className="mx-auto flex items-center gap-1 text-xs text-ink-dim hover:text-ink"><ArrowLeft className="h-3.5 w-3.5" />Back</button>
          </motion.section>
        )}
      </AnimatePresence>
      <p className="flex items-center justify-center gap-1.5 text-center text-[11px] text-ink-faint"><ShieldCheck className="h-3.5 w-3.5" />ATLAS never signs, never holds funds and never asks for keys.</p>
    </div>
  );
}

function Row({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-3 p-3.5 text-sm"><span className="text-xs text-ink-faint">{label}</span><span className="text-right">{children}</span></div>;
}

function ErrLine({ err, onRetry }: { err: { code?: string; message: string; details?: any }; onRetry?: () => void }) {
  return (
    <div role="alert" data-testid="pay-error" data-code={err.code} className="flex gap-2 rounded-xl border border-coral-down/25 bg-coral-down/[0.06] p-3 text-xs text-coral-down">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <div className="space-y-1"><div>{err.message}</div>
        {err.code === "RECIPIENT_CHANGED" && err.details?.current && <div className="text-ink-dim">Current owner: <span className="font-mono">{err.details.current}</span></div>}
        {onRetry && err.code === "RECIPIENT_CHANGED" && <button onClick={onRetry} className="text-signal hover:underline">Review the new address</button>}
      </div>
    </div>
  );
}

function BrowserWalletSend({ steps, onHash }: { steps: any[]; onHash: (h: string) => void }) {
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  return (
    <div className="space-y-1">
      <Button variant="outline" className="w-full" loading={busy} onClick={async () => {
        setBusy(true); setErr(null);
        try {
          const eth = (window as any).ethereum;
          await eth.request({ method: "eth_requestAccounts" });
          let last = "";
          for (const s of steps) last = await eth.request({ method: "eth_sendTransaction", params: [s.eip1193] });
          onHash(last);
        } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
      }}><Wallet className="h-4 w-4" />Use browser wallet instead</Button>
      {err && <p className="text-xs text-coral-down">{err}</p>}
    </div>
  );
}

/** Never claims success on its own: waits until the PaymentSent event is indexed from the chain. */
export function ReceiptTracker({ txHash, onDone }: { txHash: string; onDone?: () => void }) {
  const [found, setFound] = React.useState<any>(null);
  const [tries, setTries] = React.useState(0);
  React.useEffect(() => {
    // poll until the event is indexed, then stop (no re-run on found, so it cannot loop)
    let live = true;
    let t: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      const r = await api("/pay/receipts?direction=sent&limit=50").catch(() => null);
      const x = r?.items?.find((i: any) => i.txHash === txHash.toLowerCase());
      if (!live) return;
      if (x) setFound(x);
      else { setTries((n) => n + 1); t = setTimeout(tick, 4000); }
    };
    void tick();
    return () => { live = false; if (t) clearTimeout(t); };
  }, [txHash]);
  if (!found) return (
    <div className="space-y-3 py-4 text-center" data-testid="pay-waiting">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-signal-dim"><LiveDot className="h-3 w-3" /></div>
      <div className="font-medium">Waiting for the chain</div>
      <p className="mx-auto max-w-sm text-sm text-ink-dim">A transaction hash means it was broadcast, not that it succeeded. Your receipt appears once AtlasPay&apos;s PaymentSent event is indexed.</p>
      <div className="hash text-xs text-ink-faint">{txHash.slice(0, 18)}…</div>
      {tries > 8 && <p className="text-xs text-ink-faint">Still nothing. Check the hash in your wallet&apos;s history; a reverted transaction never produces a receipt.</p>}
    </div>
  );
  return (
    <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="space-y-3 py-2 text-center" data-testid="pay-receipt-found">
      <motion.div initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 380, damping: 18 }} className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-emerald-up/15 text-emerald-up"><CheckCircle2 className="h-7 w-7" /></motion.div>
      <div className="num text-2xl font-semibold">{found.amount} {found.asset}</div>
      <div className="text-sm text-ink-dim">to {found.recipient.agentName ?? found.recipient.wallet}</div>
      <Badge tone={found.status === "final" ? "up" : "warn"}>{found.status === "final" ? "Final" : "Provisional · awaiting confirmations"}</Badge>
      {found.txUrl && <a href={found.txUrl} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-1 text-xs text-signal hover:underline">View on explorer<ExternalLink className="h-3 w-3" /></a>}
      <Button variant="outline" className="w-full" onClick={onDone}>Done</Button>
    </motion.div>
  );
}
