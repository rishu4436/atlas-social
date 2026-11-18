"use client";
import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ShieldCheck } from "lucide-react";
import { Button, Modal, Tabs } from "@atlas/design-system";
import { api, refresh } from "@/lib/api";
import { CopyBlock, TxPanel } from "./tx-panel";

/** Fresh wallet proof (10 min). Passkeys never satisfy this. */
export function StepUp({ open, onClose, onDone, defaultMode = "baw", title = "Confirm with your Agent ID wallet" }: { open: boolean; onClose: () => void; onDone: () => void; defaultMode?: "baw" | "onchain"; title?: string }) {
  const [ch, setCh] = useState<any>(null);
  const [m, setM] = useState<"baw" | "onchain">(defaultMode);
  const [sig, setSig] = useState(""); const [rec, setRec] = useState("");
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const start = async () => { setErr(null); try { setCh(await api("/auth/step-up/challenge", { body: {} })); } catch (e: any) { setErr(e.message); } };
  const verify = async (body: any) => { await api("/auth/step-up/verify", { body: { loginId: ch.loginId, ...body } }); await refresh("/auth/session"); setCh(null); onDone(); };
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <p className="text-sm text-ink-dim">Sensitive actions need a wallet proof from the last 10 minutes. Passkeys cannot be used for this.</p>
      {!ch ? <Button className="mt-4 w-full" onClick={start}><ShieldCheck className="h-4 w-4" />Start verification</Button> : (
        <div className="mt-4 space-y-3">
          <Tabs id="stepup" value={m} onChange={setM} tabs={[{ value: "baw", label: "Sign message" }, { value: "onchain", label: "On-chain proof" }]} />
          <AnimatePresence mode="wait">
            <motion.div key={m} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-3">
              {m === "baw" ? (<>
                <CopyBlock label="preview → execute → result" text={`${ch.wallet.baw.preview}\n${ch.wallet.baw.execute}\n${ch.wallet.baw.result}`} />
                <div className="grid grid-cols-[1fr_80px] gap-2"><input className="input hash" placeholder="signature 0x…" value={sig} onChange={(e) => setSig(e.target.value)} /><input className="input hash" placeholder="rec" value={rec} onChange={(e) => setRec(e.target.value)} /></div>
                <Button className="w-full" loading={busy} disabled={sig.length < 128} onClick={async () => { setBusy(true); setErr(null); try { await verify({ mode: "signature", signature: sig.trim(), recovery: rec.trim() || undefined }); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } }}>Verify</Button>
              </>) : <TxPanel prepared={ch.onchainFallback} cta="Verify on-chain proof" onSubmitted={async () => verify({ mode: "onchain" })} />}
            </motion.div>
          </AnimatePresence>
        </div>
      )}
      {err && <p role="alert" className="mt-3 text-sm text-coral-down">{err}</p>}
    </Modal>
  );
}
