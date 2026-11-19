"use client";
import * as React from "react";
import { motion, AnimatePresence } from "motion/react";
import { AlertTriangle, CheckCircle2, BookUser, Radio, ShieldCheck } from "lucide-react";
import { Badge, Skeleton, cx } from "@atlas/design-system";
import { parseBawResolve, bawSendCommand, BAW_ADDRESS_BOOK_WARNING, BAW_BROADCAST_NOTE, type BawResolveResult } from "@atlas/auth/pay";
import { api, ApiError } from "@/lib/api";
import { CommandBlock, InfoNote } from "@/components/onboarding/parts";
import { Ticks } from "@/components/onboarding/ticks";
import { FullAddress, type PayAsset, type PayRecipient } from "./shared";

/**
 * Official Binance Agentic Wallet fallback (binance-skills-hub send.md + domain-resolve.md):
 * 1 resolve-domain → 2 show FULL address + mandatory warnings, then a separate explicit confirmation →
 * 3 `wallet send` with the resolved ADDRESS (never the name). A txHash only means "broadcast".
 */
export function BawFallback({ recipient, asset, amount, atlasAddress }: { recipient: PayRecipient; asset: PayAsset; amount: string; atlasAddress?: string | null }) {
  const [plan, setPlan] = React.useState<any>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [pasted, setPasted] = React.useState("");
  const [parsed, setParsed] = React.useState<BawResolveResult | null>(null);
  const [confirmed, setConfirmed] = React.useState(false);

  React.useEffect(() => {
    let live = true;
    api("/pay/fallback", { body: { recipientUserId: recipient.userId, asset, amount } }).then((p) => live && setPlan(p)).catch((e: ApiError) => live && setErr(e.message));
    return () => { live = false; };
  }, [recipient.userId, asset, amount]);

  // every new resolution needs a new confirmation
  React.useEffect(() => { setConfirmed(false); setParsed(pasted.trim() ? parseBawResolve(pasted, recipient.agentName) : null); }, [pasted, recipient.agentName]);

  if (err) return <p role="alert" className="text-sm text-coral-down">{err}</p>;
  if (!plan) return <Skeleton className="h-40" />;
  const ok = parsed?.ok && parsed.address;
  const differs = ok && atlasAddress && parsed!.address!.toLowerCase() !== atlasAddress.toLowerCase();
  const send = ok && confirmed ? bawSendCommand({ recipient: parsed!.address!, asset, amount }) : plan.steps[2].template;

  return (
    <div className="space-y-3" data-testid="baw-fallback">
      <div className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="h-4 w-4 text-signal" />Pay with Binance Agentic Wallet</div>
      <CommandBlock n={1} title="Resolve the Agent ID" cmd={plan.steps[0].command} testId="baw-resolve-cmd"
        why={<>Run it in your own terminal. If it returns an error, the payment is blocked: don&apos;t retry with another name or chain.</>} />

      <div className="rounded-2xl border border-line bg-white/[0.02] p-3 sm:p-4">
        <div className="flex items-start gap-3">
          <span className="num mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-signal-dim text-xs font-semibold text-signal">2</span>
          <div className="min-w-0 flex-1 space-y-2">
            <label htmlFor="baw-out" className="text-sm font-semibold">Paste the resolve output</label>
            <textarea id="baw-out" data-testid="baw-resolve-output" value={pasted} onChange={(e) => setPasted(e.target.value)} rows={3} spellCheck={false}
              placeholder='{"success":true,"data":{"name":"…","address":"0x…","isFallback":false,"addressType":"EOA"}}' className="input w-full resize-y font-mono text-[11.5px]" />
            <AnimatePresence mode="wait">
              {parsed && !parsed.ok && (
                <motion.p key="e" role="alert" data-testid="baw-resolve-error" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex gap-2 text-xs text-coral-down">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span><Ticks text={parsed.error ?? "Blocked"} /></span>
                </motion.p>
              )}
              {ok && (
                <motion.div key="ok" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-2" data-testid="baw-resolved">
                  <div className="rounded-xl bg-black/30 p-3">
                    <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-faint">{parsed!.name} resolved by baw <Badge tone={parsed!.addressType === "EOA" ? "up" : "warn"}>{parsed!.addressType}</Badge>{parsed!.isFallback && <Badge tone="warn">fallback address</Badge>}</div>
                    <FullAddress address={parsed!.address!} testId="baw-resolved-address" />
                  </div>
                  {parsed!.warnings.map((w) => <p key={w} role="alert" className="rounded-xl border border-amber-warn/25 bg-amber-warn/[0.06] p-3 text-xs leading-relaxed text-amber-warn">{w}</p>)}
                  {atlasAddress && (differs
                    ? <p data-testid="baw-differs" className="rounded-xl border border-amber-warn/25 bg-amber-warn/[0.06] p-3 text-xs leading-relaxed text-amber-warn">⚠️ This differs from the current Agent ID owner ATLAS read from the registry (<span className="font-mono">{atlasAddress}</span>). baw uses Binance&apos;s resolver record; AtlasPay would pay the NFT owner. Check with {recipient.agentName} before continuing.</p>
                    : <p data-testid="baw-matches" className="flex items-center gap-1.5 text-xs text-emerald-up"><CheckCircle2 className="h-3.5 w-3.5" />Matches the current Agent ID owner ATLAS read from the registry.</p>)}
                  <p className="flex gap-2 text-xs leading-relaxed text-ink-dim"><BookUser className="mt-0.5 h-3.5 w-3.5 shrink-0 text-signal" />{BAW_ADDRESS_BOOK_WARNING}</p>
                  <label className={cx("flex cursor-pointer items-start gap-2 rounded-xl border p-3 text-xs leading-relaxed transition-colors", confirmed ? "border-signal/40 bg-signal-dim" : "border-line")}>
                    <input type="checkbox" data-testid="baw-confirm" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5 accent-[var(--color-signal)]" />
                    <span>I checked the full address above{parsed!.warnings.length ? " and the warnings" : ""}, and I want to send <b>{amount} {asset}</b> to it{parsed!.isFallback ? " (fallback address)" : ""}{parsed!.addressType !== "EOA" ? ` (${(parsed!.addressType ?? "UNKNOWN").toLowerCase()} address)` : ""}.</span>
                  </label>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      <CommandBlock n={3} title={`Send ${amount} ${asset}`} cmd={send} placeholder={!(ok && confirmed)} testId="baw-send-cmd"
        why={ok && confirmed ? <>Uses the resolved address as <code>--recipient</code>, never the name.</> : <>Unlocks after you confirm the resolved address in step 2.</>} />
      <InfoNote><span data-testid="baw-broadcast-note"><Radio className="mr-1 inline h-3 w-3" /><Ticks text={`${BAW_BROADCAST_NOTE} ${plan.receiptNote}`} /></span></InfoNote>
    </div>
  );
}
