"use client";
import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Copy, Check, Terminal, Wallet, ShieldCheck, ChevronDown } from "lucide-react";
import { Button, Badge, cx } from "@atlas/design-system";

export function CopyBlock({ label, text, mono = true }: { label?: string; text: string; mono?: boolean }) {
  const [ok, setOk] = useState(false);
  return (
    <div className="group relative">
      {label && <div className="label mb-1">{label}</div>}
      <pre className={cx("max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-xl border border-line bg-black/40 p-3 pr-10 text-[11.5px] leading-relaxed text-ink-dim", mono && "font-mono")}>{text}</pre>
      <motion.button whileTap={{ scale: 0.85 }} onClick={() => { void navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1400); }}
        className="absolute right-2 top-2 rounded-lg p-1.5 text-ink-dim hover:bg-white/10 hover:text-ink" style={{ top: label ? 26 : 8 }} aria-label="Copy">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span key={String(ok)} initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.5, opacity: 0 }}>{ok ? <Check className="h-3.5 w-3.5 text-emerald-up" /> : <Copy className="h-3.5 w-3.5" />}</motion.span>
        </AnimatePresence>
      </motion.button>
    </div>
  );
}

declare global { interface Window { ethereum?: { request(a: { method: string; params?: unknown[] }): Promise<any> } } }

/**
 * Shows an unsigned transaction prepared by ATLAS and the two supported ways to confirm it:
 * the Agentic Wallet CLI (`baw contract-call preview` -> review -> `execute`) or an injected EIP-1193 wallet.
 * ATLAS never signs; the user pastes the resulting tx hash back for independent verification.
 */
export function TxPanel({ prepared, onSubmitted, cta = "Verify transaction" }: { prepared: any; onSubmitted: (txHash: string) => Promise<void> | void; cta?: string }) {
  const [hash, setHash] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const tx = prepared.transaction ?? prepared;
  async function viaInjected() {
    setErr(null);
    try {
      const eth = window.ethereum!;
      await eth.request({ method: "eth_requestAccounts" });
      const h = await eth.request({ method: "eth_sendTransaction", params: [prepared.eip1193] });
      setHash(h);
    } catch (e) { setErr((e as Error).message); }
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge tone="signal"><ShieldCheck className="h-3 w-3" />No value · no approvals</Badge>
        <Badge>chain {tx.chainId}</Badge>
        <span className="text-ink-dim">{tx.description}</span>
      </div>
      <div className="rounded-2xl border border-line bg-white/[0.02] p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium"><Terminal className="h-4 w-4 text-signal" />Agentic Wallet (recommended)</div>
        <ol className="space-y-3 text-sm">
          <li><CopyBlock label="1 · check Developer Mode" text={prepared.baw.checkDevMode} /></li>
          <li><CopyBlock label="2 · preview (review parsedTx, simulation, risks, authority changes)" text={prepared.baw.preview} /></li>
          <li><CopyBlock label="3 · execute only if the preview looks right" text={prepared.baw.execute} /></li>
        </ol>
        <p className="mt-3 text-xs text-ink-faint">{prepared.baw.note}</p>
      </div>
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between text-xs text-ink-dim hover:text-ink">
        <span>Raw transaction</span><motion.span animate={{ rotate: open ? 180 : 0 }}><ChevronDown className="h-4 w-4" /></motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}><CopyBlock text={JSON.stringify(tx, null, 2)} /></motion.div>}
      </AnimatePresence>
      {typeof window !== "undefined" && window.ethereum && prepared.eip1193 && (
        <Button variant="outline" onClick={viaInjected} className="w-full"><Wallet className="h-4 w-4" />Send with browser wallet instead</Button>
      )}
      <div className="space-y-2">
        <label className="label" htmlFor="txh">Transaction hash</label>
        <input id="txh" className="input hash" placeholder="0x…" value={hash} onChange={(e) => setHash(e.target.value.trim())} />
        {err && <p className="text-xs text-coral-down">{err}</p>}
        <Button className="w-full" disabled={!/^0x[0-9a-fA-F]{64}$/.test(hash)} loading={busy} onClick={async () => { setBusy(true); setErr(null); try { await onSubmitted(hash); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } }}>{cta}</Button>
      </div>
    </div>
  );
}
