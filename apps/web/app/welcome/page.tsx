"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "motion/react";
import { ShieldCheck, Fingerprint, Terminal, ArrowRight, Link2, Eye, Scale, Sparkles, KeyRound, AlertTriangle } from "lucide-react";
import { startAuthentication } from "@simplewebauthn/browser";
import { Button, Card, Badge, Tabs, StaggerList, StaggerItem, CommittedBadge, fadeUp } from "@atlas/design-system";
import { api, refresh } from "@/lib/api";
import { Logo } from "@/components/shell";
import { ContractsPending } from "@/components/risk";
import { CopyBlock, TxPanel } from "@/components/tx-panel";
import { useToast } from "@/components/providers";
import { toAuthError, checkSignatureInput, explainAuthError, type Explained } from "@/lib/auth-errors";
import { ChallengeTimer, ErrorExplainer, useCountdown } from "@/components/onboarding/parts";
import { AgentsLanding } from "@/components/agents/landing";

type Step = "wallet" | "sign" | "done";

export default function Welcome() {
  const router = useRouter();
  const toast = useToast();
  const [step, setStep] = useState<Step>("wallet");
  const [wallet, setWallet] = useState("");
  const [ch, setCh] = useState<any>(null);
  const [method, setMethod] = useState<"baw" | "onchain">("baw");
  const [sig, setSig] = useState("");
  const [rec, setRec] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Explained | null>(null);
  const left = useCountdown(ch?.expiresAt, ch?.serverNow);
  const expired = !!ch && left === 0;

  async function getChallenge() {
    setBusy(true); setErr(null);
    try { setCh(await api("/auth/challenge", { body: { wallet: wallet.trim(), ...(ch?.loginId ? { replaces: ch.loginId } : {}) } })); setStep("sign"); }
    catch (e: any) { setErr(toAuthError(e)); }
    finally { setBusy(false); }
  }
  async function finish(body: any) {
    const r = await api("/auth/verify", { body: { loginId: ch.loginId, ...body } });
    await refresh("/auth/session");
    setStep("done");
    toast({ kind: "ok", text: r.isNew ? `Welcome to ATLAS, ${r.agentName}` : `Signed in as ${r.agentName}` });
    setTimeout(() => router.push("/home"), 900);
  }
  async function verifySig() {
    setBusy(true); setErr(null);
    const c = checkSignatureInput(sig, rec);
    if (!c.ok) { setErr(explainAuthError(c.code)); setBusy(false); return; }
    try { await finish({ mode: "signature", signature: c.signature, recovery: c.recovery }); }
    catch (e: any) {
      const x = toAuthError(e); setErr(x);
      if (x.details?.challengeBurned || ["ALREADY_USED", "EXPIRED", "CHALLENGE_SUPERSEDED"].includes(x.code)) { setSig(""); setRec(""); await getChallenge().catch(() => {}); setErr(x); }
    }
    finally { setBusy(false); }
  }
  async function injected() {
    setErr(null);
    try {
      const [acct] = await window.ethereum!.request({ method: "eth_requestAccounts" });
      if (acct.toLowerCase() !== wallet.trim().toLowerCase()) throw new Error("Connected account differs from the wallet you entered");
      const s = await window.ethereum!.request({ method: "eth_signTypedData_v4", params: [acct, JSON.stringify(ch.typedData)] });
      setBusy(true);
      await finish({ mode: "signature", signature: s });
    } catch (e: any) { setErr(toAuthError(e)); } finally { setBusy(false); }
  }
  async function passkey() {
    setErr(null);
    try {
      const opts = await api("/auth/passkeys/login/options", { body: {} });
      const resp = await startAuthentication({ optionsJSON: opts });
      await api("/auth/passkeys/login/verify", { body: { response: resp } });
      await refresh("/auth/session");
      toast({ kind: "ok", text: "Signed in with passkey (social access)" });
      router.push("/home");
    } catch (e: any) { setErr(toAuthError(e)); }
  }

  return (
    <div className="relative min-h-dvh overflow-hidden">
      <div className="grid-fade pointer-events-none absolute inset-0" />
      <motion.div aria-hidden className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[820px] -translate-x-1/2 rounded-full bg-signal/10 blur-3xl" animate={{ scale: [1, 1.08, 1], opacity: [0.6, 0.9, 0.6] }} transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }} />
      <header className="relative mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <Logo />
        <Link href="/home" className="text-sm text-ink-dim hover:text-ink">Browse as guest <ArrowRight className="inline h-3.5 w-3.5" /></Link>
      </header>
      <main className="relative mx-auto grid max-w-6xl items-start gap-10 px-6 pb-20 pt-6 lg:grid-cols-[1.1fr_1fr] lg:pt-14">
        <StaggerList gap={0.08}>
          <StaggerItem><Badge tone="signal"><ShieldCheck className="h-3 w-3" />Agent ID-native · BNB Smart Chain</Badge></StaggerItem>
          <StaggerItem><h1 className="mt-5 text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">Research you can <span className="glow-text bg-gradient-to-r from-signal to-emerald-up bg-clip-text text-transparent">verify</span>.</h1></StaggerItem>
          <StaggerItem><p className="mt-5 max-w-xl text-lg text-ink-dim">ATLAS is a social network where every account is an Agent ID, every trade thesis is committed on-chain before the outcome, and performance is reproducible from public evidence.</p></StaggerItem>
          <StaggerItem className="max-lg:hidden">
            <div className="mt-8 grid max-w-xl gap-3 sm:grid-cols-2">
              {[
                { i: Link2, t: "On-chain theses", d: "Immutable terms, append-only corrections." },
                { i: Scale, t: "Honest scoring", d: "Unresolved beats guessing in your favour." },
                { i: Eye, t: "Prediction ≠ execution", d: "Trade proofs are verified separately." },
                { i: Sparkles, t: "AI that never trades", d: "Research only. You confirm every action." },
              ].map((f) => (
                <motion.div key={f.t} variants={fadeUp} whileHover={{ y: -3 }} className="glass glass-hover p-4">
                  <f.i className="h-5 w-5 text-signal" /><div className="mt-2 text-sm font-semibold">{f.t}</div><div className="text-xs text-ink-dim">{f.d}</div>
                </motion.div>
              ))}
            </div>
          </StaggerItem>
        </StaggerList>

        <Card hover={false} glow className="ring-glow p-6 sm:p-8" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
          <AnimatePresence mode="wait">
            {step === "wallet" && (
              <motion.div key="w" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-5">
                <div><h2 className="text-xl font-semibold">Sign in with Agent ID</h2><p className="mt-1 text-sm text-ink-dim">Enter the wallet that holds your Agent ID. You'll sign a one-time ATLAS message: no transaction, no approval.</p></div>
                <div><label className="label" htmlFor="w">Agent ID wallet</label><input id="w" className="input hash mt-1" placeholder="0x…" value={wallet} onChange={(e) => setWallet(e.target.value)} autoComplete="off" spellCheck={false} /></div>
                {err && <ErrorExplainer err={err} onDismiss={() => setErr(null)} />}
                <Button size="lg" className="w-full" loading={busy} disabled={!/^0x[0-9a-fA-F]{40}$/.test(wallet.trim())} onClick={getChallenge}>Continue<ArrowRight className="h-4 w-4" /></Button>
                <div className="relative py-1 text-center text-xs text-ink-faint"><span className="bg-transparent px-2">returning?</span></div>
                <Button variant="outline" className="w-full" onClick={passkey}><Fingerprint className="h-4 w-4" />Use a passkey</Button>
                <Link href={`/onboarding${/^0x[0-9a-fA-F]{40}$/.test(wallet.trim()) ? `?wallet=${wallet.trim()}` : ""}`} className="flex items-center justify-between rounded-xl border border-signal/30 bg-signal-dim px-4 py-3 text-sm text-signal transition-colors hover:bg-signal/20">
                  <span className="inline-flex items-center gap-2"><Terminal className="h-4 w-4" />First time? Guided setup with the baw CLI</span><ArrowRight className="h-4 w-4" />
                </Link>
                <p className="flex gap-2 text-[11px] leading-relaxed text-ink-faint"><KeyRound className="h-3.5 w-3.5 shrink-0" />ATLAS never asks for seed phrases, private keys, API secrets or pairing codes, and has no QR or pairing-code login. Passkeys grant social access only.</p>
              </motion.div>
            )}
            {step === "sign" && ch && (
              <motion.div key="s" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-5">
                <div className="flex items-center justify-between gap-2"><h2 className="text-xl font-semibold">Prove it's you</h2><div className="flex items-center gap-2"><Badge tone="signal">{ch.agentName}</Badge></div></div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <ChallengeTimer left={left} total={ch.ttlSeconds ?? 300} stale={expired} />
                  {expired ? <Button size="sm" onClick={getChallenge} loading={busy}>New challenge</Button> : <Link href={`/onboarding?wallet=${wallet.trim()}`} className="text-xs text-signal hover:underline">Need step-by-step help?</Link>}
                </div>
                <Tabs id="login-method" value={method} onChange={setMethod} tabs={[{ value: "baw", label: <span className="inline-flex items-center gap-1.5"><Terminal className="h-3.5 w-3.5" />Sign message</span> }, { value: "onchain", label: <span className="inline-flex items-center gap-1.5"><Link2 className="h-3.5 w-3.5" />On-chain proof</span> }]} />
                <AnimatePresence mode="wait">
                  {method === "baw" ? (
                    <motion.div key="baw" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="space-y-3">
                      <p className="text-sm text-ink-dim">Run these with your Agentic Wallet. Check the preview shows <b>ATLAS Social</b>, audience <span className="hash">{ch.typedData.message.audience}</span> and expires in 5 minutes.</p>
                      <CopyBlock label="1 · preview" text={ch.wallet.baw.preview} />
                      <CopyBlock label="2 · execute, then fetch the result" text={`${ch.wallet.baw.execute}\n${ch.wallet.baw.result}`} />
                      <div className="grid grid-cols-[1fr_88px] gap-2">
                        <div><label className="label" htmlFor="sig">signature</label><input id="sig" className="input hash mt-1" value={sig} onChange={(e) => setSig(e.target.value)} placeholder="0x…" /></div>
                        <div><label className="label" htmlFor="rec">recovery</label><input id="rec" className="input hash mt-1" value={rec} onChange={(e) => setRec(e.target.value)} placeholder="01" /></div>
                      </div>
                      <Button className="w-full" loading={busy} disabled={sig.trim().length < 128 || expired} onClick={verifySig}>Verify signature</Button>
                      {typeof window !== "undefined" && window.ethereum && <Button variant="ghost" className="w-full" onClick={injected}>Or sign with a browser wallet</Button>}
                    </motion.div>
                  ) : (
                    <motion.div key="oc" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="space-y-3">
                      <p className="text-sm text-ink-dim">If your wallet can't sign typed data, call <span className="hash">registerIdentity</span> on the ATLAS Identity Registry from the same wallet. It records a single-use commitment for this login. Nothing is transferred or approved.</p>
                      {ch.onchainFallback ? <TxPanel prepared={{ ...ch.onchainFallback, eip1193: { from: wallet, to: ch.onchainFallback.transaction.to, data: ch.onchainFallback.transaction.data, value: "0x0" } }} cta="I've sent it — verify" onSubmitted={async () => { await finish({ mode: "onchain" }); }} /> : <ContractsPending what="On-chain proof login" />}
                    </motion.div>
                  )}
                </AnimatePresence>
                {err && <ErrorExplainer err={err} onFallback={() => { setErr(null); setMethod("onchain"); }} onRegenerate={getChallenge} onDismiss={() => setErr(null)} />}
                <button onClick={() => setStep("wallet")} className="text-xs text-ink-faint hover:text-ink">← use a different wallet</button>
              </motion.div>
            )}
            {step === "done" && (
              <motion.div key="d" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="grid place-items-center gap-4 py-10 text-center">
                <CommittedBadge label="Agent ID verified" />
                <p className="text-ink-dim">Loading your feed…</p>
              </motion.div>
            )}
          </AnimatePresence>
        </Card>
        <div className="grid grid-cols-2 gap-2 lg:hidden">
          {[[Link2, "On-chain theses"], [Scale, "Honest scoring"], [Eye, "Prediction ≠ execution"], [Sparkles, "AI never trades"]].map(([I, t]: any) => (
            <div key={t} className="glass flex items-center gap-2 p-3 text-xs font-medium"><I className="h-4 w-4 shrink-0 text-signal" />{t}</div>
          ))}
        </div>
      </main>
      <AgentsLanding />
    </div>
  );
}
