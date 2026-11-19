"use client";
import * as React from "react";
import { motion, AnimatePresence } from "motion/react";
import { HandCoins, Send } from "lucide-react";
import { Button, cx } from "@atlas/design-system";
import { isPayAmount } from "@atlas/auth/pay";
import { api, ApiError } from "@/lib/api";
import { CopyBlock } from "@/components/tx-panel";
import { Sheet, AssetToggle, type PayAsset } from "./shared";

const EXPIRY = [{ h: 24, l: "24 hours" }, { h: 168, l: "7 days" }, { h: 720, l: "30 days" }];

/** Create a shareable request. In a DM the card is posted into the conversation as a link (no address, no content in the request). */
export function RequestComposer({ open, onClose, context, payerUserId, onCreated, title = "Request a payment" }: {
  open: boolean; onClose: () => void; context: { kind: "link" | "post" | "dm"; id?: string }; payerUserId?: string; onCreated?: (r: any) => Promise<void> | void; title?: string;
}) {
  const [asset, setAsset] = React.useState<PayAsset>("USDT");
  const [amount, setAmount] = React.useState("");
  const [note, setNote] = React.useState("");
  const [hours, setHours] = React.useState(168);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [made, setMade] = React.useState<any>(null);
  React.useEffect(() => { if (!open) { setMade(null); setErr(null); setAmount(""); setNote(""); } }, [open]);
  const create = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api("/pay/requests", { body: { asset, amount, note, context, expiresInHours: hours, ...(payerUserId ? { payerUserId } : {}) } });
      setMade(r);
      await onCreated?.(r);
    } catch (e) { setErr((e as ApiError).message); } finally { setBusy(false); }
  };
  return (
    <Sheet open={open} onClose={onClose} label={title} testId="request-composer">
      <div className="space-y-4">
        <div className="flex items-center gap-2 pr-8 text-lg font-semibold"><HandCoins className="h-5 w-5 text-signal" />{title}</div>
        <AnimatePresence mode="wait" initial={false}>
          {!made ? (
            <motion.div key="form" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="space-y-4">
              <AssetToggle value={asset} onChange={setAsset} />
              <div className="rounded-3xl border border-line bg-white/[0.02] p-5 text-center">
                <label htmlFor="req-amount" className="label">Amount</label>
                <div className="mt-1 flex items-baseline justify-center gap-2">
                  <input id="req-amount" data-testid="req-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(",", ".").replace(/[^0-9.]/g, ""))} placeholder="0.00"
                    className="num w-full min-w-0 bg-transparent text-center text-4xl font-semibold outline-none placeholder:text-ink-faint/50" style={{ maxWidth: `${Math.max(4, amount.length + 1)}ch` }} />
                  <span className="text-lg text-ink-dim">{asset}</span>
                </div>
              </div>
              <div>
                <label htmlFor="req-note" className="label">What it&apos;s for (optional, visible on the card)</label>
                <input id="req-note" data-testid="req-note" className="input mt-1" maxLength={140} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. research bounty, shared data feed" />
              </div>
              <div className="flex flex-wrap gap-2">{EXPIRY.map((x) => <button key={x.h} onClick={() => setHours(x.h)} className={cx("rounded-full border px-3 py-1 text-xs", hours === x.h ? "border-signal/50 text-signal" : "border-line text-ink-dim")}>Expires in {x.l}</button>)}</div>
              <p className="text-xs leading-relaxed text-ink-faint">The payer authorizes it in their own wallet. ATLAS never pulls funds, and a request card never shows your wallet address. Payments never change Skill Score or points.</p>
              {err && <p role="alert" className="text-xs text-coral-down">{err}</p>}
              <Button className="w-full" size="lg" disabled={!isPayAmount(amount)} loading={busy} onClick={create} data-testid="req-create"><Send className="h-4 w-4" />{context.kind === "dm" ? "Send request in chat" : "Create request"}</Button>
            </motion.div>
          ) : (
            <motion.div key="done" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="space-y-3" data-testid="req-created">
              <p className="text-sm text-ink-dim">Request for <b className="text-ink">{made.amount} {made.asset}</b> created{context.kind === "dm" ? " and shared in this conversation" : ""}.</p>
              <CopyBlock label="Share link" text={made.shareUrl} />
              <Button variant="outline" className="w-full" onClick={onClose}>Done</Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Sheet>
  );
}
