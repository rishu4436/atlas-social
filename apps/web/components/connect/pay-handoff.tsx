"use client";
import { useEffect, useRef, useState } from "react";
import { PayStageStepper } from "@/components/pay/stage";
import type { PayStage } from "@atlas/auth/pay-status";
import { motion } from "motion/react";
import { AlertTriangle, BookUser, CheckCircle2, ExternalLink, Fuel, Network, ShieldCheck } from "lucide-react";
import { Badge, Skeleton } from "@atlas/design-system";
import { api } from "@/lib/api";
import { FullAddress } from "@/components/pay/shared";
import { useConnect } from "./use-connect";
import { ConnectStepper, CountdownRing, HandoffPanel, StatusLine, ISSUE_375 } from "./connect-flow";

function useLeft(expiresAt?: number) {
  const [n, setN] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => { const t = setInterval(() => setN(Math.floor(Date.now() / 1000)), 1000); return () => clearInterval(t); }, []);
  return expiresAt ? Math.max(0, expiresAt - n) : 0;
}

/**
 * ATLAS Pay through ATLAS Connect: the browser prepares the payment, the user's own agent/terminal runs
 * `baw contract-call preview` → approve → execute (or the official fallback), and ATLAS verifies the broadcast tx
 * against the reviewed step. The backend never signs, never holds a wallet session, never moves funds.
 */
export function PayHandoff({ body, onTx }: { body: Record<string, unknown>; onTx: (hash: string, mode: "contract-call" | "fallback") => void }) {
  const c = useConnect({ purpose: "pay", create: () => api("/pay/handoff", { body }), pollMs: 2000 });
  const started = useRef(false);
  useEffect(() => { if (!started.current) { started.current = true; void c.start(); } }, [c]);
  const p = c.created?.payment;
  const v = c.view;
  const left = useLeft(v?.expiresAt);
  const hashes = (v?.result?.txHashes ?? []).filter(Boolean) as string[];
  const done = v?.status === "submitted";
  const reported = useRef(false);
  useEffect(() => { if (done && hashes.length && !reported.current && p) { reported.current = true; onTx(hashes[hashes.length - 1]!, p.mode); } }, [done, hashes, p, onTx]);

  if (c.error && !c.created) return <p role="alert" data-testid="pay-error" className="text-sm text-coral-down">{c.error.message}</p>;
  if (!c.created || !p) return <Skeleton className="h-64" />;
  return (
    <motion.div className="space-y-4" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} data-testid="pay-connect">
      <div className="space-y-2 rounded-2xl border border-line bg-white/[0.02] p-4" data-testid="pay-connect-summary">
        <div className="flex items-center justify-between">
          <div className="num text-2xl font-semibold">{p.amount} <span className="text-base text-ink-dim">{p.asset}</span>{p.stableIsMock && <Badge tone="warn" className="ml-2">local mock</Badge>}</div>
          <Badge><Network className="h-3 w-3" />{p.network?.name} · {p.network?.chainId}</Badge>
        </div>
        <div className="text-xs text-ink-faint">to <b className="text-ink">{p.recipient.agentName}</b> — full destination address:</div>
        <FullAddress address={p.recipient.address} testId="pay-connect-address" />
        <div className="grid gap-1 pt-1 text-xs text-ink-dim">
          <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5 text-signal" />From your verified wallet <span className="hash">{p.from}</span></span>
          {p.gasEstimate && <span className="inline-flex items-center gap-1.5"><Fuel className="h-3.5 w-3.5" />Fee {p.gasEstimate.feeBnb ? `≈ ${Number(p.gasEstimate.feeBnb).toPrecision(3)} BNB` : `≈ ${Number(p.gasEstimate.gas).toLocaleString()} gas`} · your wallet shows the final fee</span>}
          {p.mode === "contract-call"
            ? <span>{p.steps.length === 2 ? "2 wallet steps: approve exactly this amount, then pay" : "1 wallet step: AtlasPay pays the current Agent ID owner"} · each previewed in your wallet first</span>
            : <span className="inline-flex items-start gap-1.5"><BookUser className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />AtlasPay is pending, so this uses the official baw flow: resolve the name, compare with the address above, it must be in your Binance address book, then send. A plain transfer creates no ATLAS receipt.</span>}
        </div>
        <p className="flex gap-1.5 pt-1 text-[11px] text-amber-200/90"><AlertTriangle className="h-3.5 w-3.5 shrink-0" />Payments are final once confirmed. Execute only if your wallet preview shows exactly this address, network, token and amount.{p.mode === "contract-call" && <> If the contract-call preview fails (<a className="underline" href={ISSUE_375} target="_blank" rel="noreferrer">#375</a>), stop; there is no bypass.</>}</p>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0"><div className="text-xs uppercase tracking-wider text-ink-faint">ATLAS Connect · payment</div><div data-testid="connect-code" className="hash truncate text-sm">{c.created.code}</div></div>
        {!done && v?.status !== "expired" && <CountdownRing left={left} total={c.created.ttlSeconds} />}
      </div>
      <ConnectStepper status={v?.status} stage={v?.stage} />
      {done ? (
        <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="space-y-3 rounded-2xl border border-signal/25 bg-signal/[0.04] p-4 text-sm" data-testid="pay-connect-verified">
          <div className="flex items-center gap-2 font-medium"><ShieldCheck className="h-4 w-4 text-signal" />Matches the reviewed {p.mode === "contract-call" ? "step" : "transfer"} — this is not a payment confirmation</div>
          {hashes.map((h, i) => {
            const t = ((v as any)?.txs ?? []).find((x: any) => x?.txHash === h.toLowerCase());
            return (
              <div key={h} className="space-y-1.5 rounded-xl border border-line bg-black/20 p-3">
                <div className="flex items-center justify-between text-xs text-ink-faint"><span>{t?.stepKind === "approve" ? "USDT approval (not a payment)" : `Step ${i + 1}`}</span><span className="hash">{h.slice(0, 10)}…{h.slice(-6)}</span></div>
                <PayStageStepper stage={(t?.stage ?? "broadcast") as PayStage} />
                {t?.txUrl && <a className="inline-flex items-center gap-1 text-xs text-signal hover:underline" href={t.txUrl} target="_blank" rel="noreferrer">View tx<ExternalLink className="h-3 w-3" /></a>}
              </div>
            );
          })}
          <p className="text-xs text-ink-faint">Paid only once it is Finalized on-chain. {p.mode === "contract-call" ? "Your receipt appears once the PaymentSent event is indexed." : "A plain transfer creates no ATLAS receipt."}</p>
        </motion.div>
      ) : v?.status === "expired" ? (
        <p className="rounded-xl border border-line bg-black/25 p-3 text-sm">This payment code expired. Close and review again.</p>
      ) : (<>
        <HandoffPanel code={c.created.code} handoff={c.created.handoff} purpose="pay" />
        <StatusLine status={v?.status} stage={v?.stage} detail={v?.stageDetail} />
      </>)}
    </motion.div>
  );
}
