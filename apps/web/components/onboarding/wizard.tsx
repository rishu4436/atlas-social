"use client";
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "motion/react";
import {
  ArrowRight, ArrowLeft, Terminal, Fingerprint, CheckCircle2, Circle, Link2, RefreshCw, ShieldCheck, Wallet, KeyRound, Sparkles, ClipboardPaste, Loader2, BookOpen,
} from "lucide-react";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { Button, Badge, Card, CommittedBadge, Tabs, cx } from "@atlas/design-system";
import { api, refresh, pathAfterSignIn } from "@/lib/api";
import {
  SHELLS, parseBawOutput, checkSignatureInput, bawExecuteCommand, bawResultCommand, explainAuthError, toAuthError, type ShellKind, type Explained, type BawParse,
} from "@/lib/auth-errors";
import { ContractsPending } from "@/components/risk";
import { useToast } from "@/components/providers";
import { ChallengeTimer, CommandBlock, ErrorExplainer, Stepper, SafetyNote, InfoNote, LiveDot, useCountdown } from "./parts";

const STEPS = ["Prerequisites", "Agent ID wallet", "Sign with baw", "Verify", "Passkey"];
type Stale = null | "expired" | "superseded" | "used";
const STALE_LABEL: Record<Exclude<Stale, null>, string> = { expired: "challenge expired", superseded: "replaced by a newer challenge", used: "challenge already used" };

const slide = { initial: { opacity: 0, x: 24 }, animate: { opacity: 1, x: 0 }, exit: { opacity: 0, x: -24 } };

function detectShell(): ShellKind {
  if (typeof navigator === "undefined") return "posix";
  return /Windows/i.test(navigator.userAgent) ? "powershell" : "posix";
}

function PasteBox({ id, label, value, onChange, hint }: { id: string; label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  return (
    <div>
      <label htmlFor={id} className="label flex items-center gap-1.5"><ClipboardPaste className="h-3.5 w-3.5" />{label}</label>
      <textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} rows={3} spellCheck={false} autoComplete="off"
        placeholder='{"success":true,"data":{…}}' className="input mt-1 min-h-[76px] resize-y font-mono text-[11.5px]" />
      {hint && <p className="mt-1 text-[11px] text-ink-faint">{hint}</p>}
    </div>
  );
}

function ParsedLine({ p }: { p: BawParse | null }) {
  if (!p || p.kind === "unknown" || p.kind === "error") return null;
  const text =
    p.kind === "preview" ? `Preview OK · requestId ${p.requestId}${p.requireConfirmation ? " · will need approval in the Binance App" : ""}` :
    p.kind === "signature" ? "Signature received and filled in below" :
    p.kind === "pending" ? `Waiting for approval · orderId ${p.orderId}` :
    p.kind === "broadcast" ? `Broadcast · tx ${p.txHash.slice(0, 10)}…` :
    p.kind === "settings" ? (p.devModeOn ? "Developer Mode is on" : "Developer Mode is off") :
    p.kind === "agent-id" ? (p.claimed ? `Agent ID found: ${p.agentId ?? "claimed"}` : "No Agent ID claimed on this wallet") :
    p.kind === "address" ? `Wallet address ${p.address}` : "";
  const good = !(p.kind === "settings" && !p.devModeOn) && !(p.kind === "agent-id" && !p.claimed);
  return <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} data-testid="parsed-line" className={cx("flex items-center gap-1.5 text-xs", good ? "text-emerald-up" : "text-amber-warn")}><CheckCircle2 className="h-3.5 w-3.5" />{text}</motion.p>;
}

export function OnboardingWizard() {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const [step, setStep] = React.useState(0);
  const [path, setPath] = React.useState<"signature" | "onchain">("signature");
  const [shell, setShell] = React.useState<ShellKind>("posix");
  React.useEffect(() => setShell(detectShell()), []);

  // prerequisites
  const [preOut, setPreOut] = React.useState("");
  const [checks, setChecks] = React.useState({ install: false, agentId: false, devMode: false, address: false });
  const preParsed = React.useMemo(() => (preOut.trim() ? parseBawOutput(preOut) : null), [preOut]);

  // challenge
  const [wallet, setWallet] = React.useState(params.get("wallet") ?? "");
  const [ch, setCh] = React.useState<any>(null);
  const [stale, setStale] = React.useState<Stale>(null);
  const [autoRenew, setAutoRenew] = React.useState(false);
  const autoCount = React.useRef(0);
  const left = useCountdown(ch?.expiresAt, ch?.serverNow);

  // signing
  const [previewOut, setPreviewOut] = React.useState("");
  const [execOut, setExecOut] = React.useState("");
  const [resultOut, setResultOut] = React.useState("");
  const [sig, setSig] = React.useState("");
  const [rec, setRec] = React.useState("");
  const [err, setErr] = React.useState<Explained | null>(null);
  const [busy, setBusy] = React.useState<null | "challenge" | "verify" | "passkey" | "regen">(null);
  const [verified, setVerified] = React.useState<any>(null);
  const [passkeyDone, setPasskeyDone] = React.useState(false);

  // on-chain fallback
  const [ocPreviewOut, setOcPreviewOut] = React.useState("");
  const [ocExecOut, setOcExecOut] = React.useState("");

  const ctx = ch ? { wallet: ch.typedData.message.wallet as string, chainId: ch.chainId ?? ch.typedData.domain.chainId, loginId: ch.loginId as string, audience: ch.typedData.message.audience as string } : undefined;
  const pPreview = React.useMemo(() => (previewOut.trim() ? parseBawOutput(previewOut, ctx) : null), [previewOut, ch?.loginId]); // eslint-disable-line react-hooks/exhaustive-deps
  const pExec = React.useMemo(() => (execOut.trim() ? parseBawOutput(execOut, ctx) : null), [execOut, ch?.loginId]); // eslint-disable-line react-hooks/exhaustive-deps
  const pResult = React.useMemo(() => (resultOut.trim() ? parseBawOutput(resultOut, ctx) : null), [resultOut, ch?.loginId]); // eslint-disable-line react-hooks/exhaustive-deps
  const pOcPreview = React.useMemo(() => (ocPreviewOut.trim() ? parseBawOutput(ocPreviewOut) : null), [ocPreviewOut]);
  const pOcExec = React.useMemo(() => (ocExecOut.trim() ? parseBawOutput(ocExecOut) : null), [ocExecOut]);

  // prerequisite output → tick items / prefill the wallet
  React.useEffect(() => {
    const p = preParsed;
    if (!p) return;
    if (p.kind === "agent-id" && p.claimed) setChecks((c) => ({ ...c, agentId: true, install: true }));
    if (p.kind === "settings" && p.devModeOn) setChecks((c) => ({ ...c, devMode: true, install: true }));
    if (p.kind === "address") { setChecks((c) => ({ ...c, address: true, install: true })); setWallet(p.address); }
  }, [preParsed]);

  // execute/result output → fill the signature
  React.useEffect(() => {
    for (const p of [pExec, pResult]) if (p?.kind === "signature") { setSig(p.signature); setRec(p.recovery ?? ""); }
  }, [pExec, pResult]);

  // client-side expiry
  React.useEffect(() => { if (ch && left === 0 && !stale && step >= 2 && !verified) setStale("expired"); }, [left, ch, stale, step, verified]);

  // server-side state (another tab regenerated, or the challenge was burned)
  React.useEffect(() => {
    if (!ch || stale || step !== 2) return;
    const t = setInterval(async () => {
      try {
        const s = await api(`/auth/challenge/${ch.loginId}`);
        if (s.state !== "active") setStale(s.state);
      } catch { /* API asleep: the local countdown still applies */ }
    }, 20_000);
    return () => clearInterval(t);
  }, [ch, stale, step]);

  const walletOk = /^0x[0-9a-fA-F]{40}$/.test(wallet.trim());

  async function getChallenge(replaces?: string, opts: { keepError?: boolean; auto?: boolean } = {}) {
    setBusy(replaces ? "regen" : "challenge");
    if (!opts.keepError) setErr(null);
    if (!opts.auto) autoCount.current = 0;
    try {
      const c = await api("/auth/challenge", { body: { wallet: wallet.trim(), ...(replaces ? { replaces } : {}) } });
      setCh(c); setStale(null);
      setPreviewOut(""); setExecOut(""); setResultOut(""); setSig(""); setRec(""); setOcPreviewOut(""); setOcExecOut("");
      if (step < 2) setStep(2);
      if (replaces) toast({ kind: "info", text: "New challenge issued. The old commands no longer work." });
    } catch (e) {
      setErr(toAuthError(e));
    } finally { setBusy(null); }
  }
  const regenerate = (o: { keepError?: boolean; auto?: boolean } = {}) => getChallenge(ch?.loginId, o);

  // optional automatic renewal on expiry (bounded so an idle tab doesn't loop forever)
  React.useEffect(() => {
    if (stale === "expired" && autoRenew && !busy && autoCount.current < 3 && step === 2) { autoCount.current++; void regenerate({ auto: true }); }
  }, [stale, autoRenew]); // eslint-disable-line react-hooks/exhaustive-deps

  async function verify(body: { mode: "signature"; signature: string; recovery?: string } | { mode: "onchain" }) {
    setErr(null); setBusy("verify");
    setStep(3);
    try {
      const r = await api("/auth/verify", { body: { loginId: ch.loginId, ...body } });
      await refresh("/auth/session");
      setVerified(r);
      toast({ kind: "ok", text: r.isNew ? `Welcome to ATLAS, ${r.agentName}` : `Signed in as ${r.agentName}` });
      setTimeout(() => setStep(4), 1400);
    } catch (e) {
      const x = toAuthError(e);
      setStep(2);
      setErr(x);
      if (x.code === "PROOF_PENDING") return; // challenge still valid: just retry
      if (x.details?.challengeBurned) { setStale("used"); await regenerate({ keepError: true }); return; }
      if (x.code === "EXPIRED") setStale("expired");
      else if (x.code === "ALREADY_USED") setStale("used");
      else if (x.code === "CHALLENGE_SUPERSEDED") setStale("superseded");
    } finally { setBusy(null); }
  }

  function submitSignature() {
    const c = checkSignatureInput(sig, rec);
    if (!c.ok) { setErr(explainAuthError(c.code)); return; } // caught locally: the challenge is not burned
    void verify({ mode: "signature", signature: c.signature, recovery: c.recovery });
  }

  async function passkeyLogin() {
    setErr(null); setBusy("passkey");
    try {
      const opts = await api("/auth/passkeys/login/options", { body: {} });
      const resp = await startAuthentication({ optionsJSON: opts });
      await api("/auth/passkeys/login/verify", { body: { response: resp } });
      await refresh("/auth/session");
      toast({ kind: "ok", text: "Signed in with passkey (social access)" });
      router.push(await pathAfterSignIn());
    } catch (e) { setErr(toAuthError(e)); } finally { setBusy(null); }
  }

  async function addPasskey() {
    setErr(null); setBusy("passkey");
    try {
      const opts = await api("/auth/passkeys/register/options", { body: {} });
      const resp = await startRegistration({ optionsJSON: opts });
      await api("/auth/passkeys/register/verify", { body: { response: resp, name: "Onboarding device" } });
      setPasskeyDone(true);
      toast({ kind: "ok", text: "Passkey added" });
    } catch (e) { setErr(toAuthError(e)); } finally { setBusy(null); }
  }

  const sigCheck = sig.trim() ? checkSignatureInput(sig, rec) : null;
  const shellInfo = SHELLS.find((s) => s.id === shell)!;
  const staleReason = stale ? STALE_LABEL[stale] : undefined;
  const pendingOrder = pExec?.kind === "pending" ? pExec.orderId : null;
  const inlineErr = (p: BawParse | null): Explained | null => (p?.kind === "error" ? { ...explainAuthError(p.code), details: { bawCode: p.bawCode } } : p?.kind === "preview" && p.warning ? explainAuthError(p.warning) : null);
  const contractsPending = !!ch && (ch.contractsPending || !ch.onchainFallback);

  // ---------------------------------------------------------------- render
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Card hover={false} glow className="ring-glow p-4 sm:p-7" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
        <Stepper steps={STEPS} current={step} />
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="label">Your shell</span>
            <Tabs id="shell" value={shell} onChange={setShell} tabs={SHELLS.map((s) => ({ value: s.id, label: s.label }))} />
          </div>
          {ch && step >= 2 && step < 4 && !verified && <ChallengeTimer left={left} total={ch.ttlSeconds ?? 300} stale={!!stale} />}
        </div>
        <p className="mt-2 text-[11px] text-ink-faint" data-testid="shell-note">{shellInfo.note}</p>

        <div className="mt-5">
          <AnimatePresence mode="wait">
            {/* ------------------------------------------------ 0 prerequisites */}
            {step === 0 && (
              <motion.section key="pre" {...slide} className="space-y-4" aria-labelledby="pre-h">
                <div>
                  <h2 id="pre-h" className="text-xl font-semibold">Before you start</h2>
                  <p className="mt-1 text-sm text-ink-dim">You need the official Binance Agentic Wallet CLI (<code>baw</code>), Developer Mode, and a wallet that holds an Agent ID. Takes about 3 minutes the first time.</p>
                </div>
                <div className="grid gap-3">
                  <PreItem done={checks.install} n={1} title="Install the Agentic Wallet CLI" cmd="npm i -g @binance/agentic-wallet"
                    why={<>Installs <code>baw</code> from npm (Binance's official package). Needs Node.js 20+ (<code>node -v</code>).{" "}
                      {shell === "posix" ? <>On macOS/Linux, if npm says <code>EACCES</code>, use a Node version manager (nvm) instead of <code>sudo</code>.</> : <>On Windows, install Node.js LTS first (<code>winget install OpenJS.NodeJS.LTS</code>), then open a new terminal.</>}</>} />
                  <PreItem done={checks.install} n={2} title="Connect baw to your own wallet" cmd="baw wallet status --json"
                    why={<>If it isn't connected, run <code>baw auth signin</code> and finish Binance's own sign-in in your Binance App. That happens between you and Binance; ATLAS never sees it.</>} />
                  <PreItem done={checks.agentId} n={3} title="Confirm you hold an Agent ID" cmd="baw wallet agent-id --json"
                    why={<>Should say <code>"claimed": true</code> and show your <code>name.ai</code>. No Agent ID? Claim one in the Binance App (Web3 wallet → Agent ID).</>} />
                  <PreItem done={checks.devMode} n={4} title="Turn on Developer Mode" cmd="baw wallet settings --json"
                    why={<>External signing needs it. Binance App → Agentic Wallet → Settings → Developer Mode → accept the risk warning. Look for <code>"devMode": {"{"} "enabled": true {"}"}</code>. It lasts 7 days.</>} />
                  <PreItem done={checks.address} n={5} title="Get your wallet address" cmd="baw wallet address --json" why="You'll enter this address next. Pasting the output below fills it in." />
                </div>
                <PasteBox id="pre-out" label="Optional: paste any output above to check it" value={preOut} onChange={setPreOut} hint="Checked locally in your browser. Nothing you paste here is uploaded." />
                <ParsedLine p={preParsed} />
                <AnimatePresence>{inlineErr(preParsed) && <ErrorExplainer err={inlineErr(preParsed)!} onFallback={() => setStep(1)} />}</AnimatePresence>
                <SafetyNote />
                <div className="flex justify-end"><Button size="lg" onClick={() => setStep(1)}>I'm ready<ArrowRight className="h-4 w-4" /></Button></div>
              </motion.section>
            )}

            {/* ------------------------------------------------ 1 wallet → challenge */}
            {step === 1 && (
              <motion.section key="wallet" {...slide} className="space-y-4" aria-labelledby="w-h">
                <div>
                  <h2 id="w-h" className="text-xl font-semibold">Your Agent ID wallet</h2>
                  <p className="mt-1 text-sm text-ink-dim">ATLAS checks the official Agent ID registry live, then issues a one-time login challenge bound to this wallet, this website and a 5-minute window.</p>
                </div>
                <div>
                  <label className="label" htmlFor="ob-wallet">Agent ID wallet address</label>
                  <input id="ob-wallet" className="input hash mt-1" placeholder="0x…" value={wallet} onChange={(e) => setWallet(e.target.value)} autoComplete="off" spellCheck={false} />
                  {wallet && !walletOk && <p className="mt-1 text-xs text-amber-warn">An address is 0x followed by 40 hex characters.</p>}
                </div>
                <AnimatePresence>{err && <ErrorExplainer err={err} onRetry={() => getChallenge()} onDismiss={() => setErr(null)} />}</AnimatePresence>
                <div className="flex items-center justify-between gap-2">
                  <Button variant="ghost" onClick={() => { setErr(null); setStep(0); }}><ArrowLeft className="h-4 w-4" />Back</Button>
                  <Button size="lg" disabled={!walletOk} loading={busy === "challenge"} onClick={() => getChallenge()}>Generate my commands<ArrowRight className="h-4 w-4" /></Button>
                </div>
              </motion.section>
            )}

            {/* ------------------------------------------------ 2 sign (or on-chain fallback) */}
            {step === 2 && ch && (
              <motion.section key={`sign-${path}`} {...slide} className="space-y-4" aria-labelledby="s-h">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h2 id="s-h" className="text-xl font-semibold">{path === "signature" ? "Sign the ATLAS login with baw" : "On-chain proof (registerIdentity)"}</h2>
                    <p className="mt-1 text-sm text-ink-dim">
                      {path === "signature"
                        ? <>These commands are generated from <b>your</b> live challenge <code className="text-ink">{ch.loginId.slice(0, 8)}…</code>. Run them in order on your machine. Signing proves you control the wallet; it moves no funds and approves nothing.</>
                        : <>If your wallet can't sign the login message, prove ownership with one transaction from the same wallet. It records a single-use commitment for this challenge. No value, no token approval.</>}
                    </p>
                  </div>
                  <Badge tone="signal"><ShieldCheck className="h-3 w-3" />{ch.agentName}</Badge>
                </div>

                <AnimatePresence>
                  {stale && (
                    <motion.div key="stale" role="status" data-testid="stale-banner" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-coral-down/30 bg-coral-down/[0.07] p-3">
                        <div className="text-sm"><b>These commands are stale</b> <span className="text-ink-dim">({staleReason}). A signature made from them will be rejected.</span></div>
                        <Button size="sm" onClick={() => regenerate()} loading={busy === "regen"}><RefreshCw className="h-3.5 w-3.5" />Generate new challenge</Button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <AnimatePresence>{err && <ErrorExplainer err={err} busy={busy === "regen" || busy === "verify"} onRegenerate={() => regenerate()} onFallback={() => { setErr(null); setPath("onchain"); }} onRetry={path === "onchain" ? () => verify({ mode: "onchain" }) : undefined} onDismiss={() => setErr(null)} />}</AnimatePresence>

                {path === "signature" ? (
                  <div className="space-y-3">
                    <CommandBlock n={1} testId="cmd-preview" title="Preview the login message" cmd={ch.wallet.baw.previewByShell?.[shell] ?? ch.wallet.baw.preview} stale={!!stale} staleReason={staleReason}
                      why="Asks your wallet to parse the message and run Binance's risk checks. Nothing is signed yet."
                      check={<ul className="list-disc space-y-1 pl-4">
                        <li><code>parsedMessage</code> shows domain <b>ATLAS Social</b>, chainId <b>{ch.chainId}</b>, primaryType <b>AtlasLogin</b>.</li>
                        <li>audience is <b className="hash">{ch.typedData.message.audience}</b> and wallet is yours.</li>
                        <li>loginId starts with <b className="hash">{ch.loginId.slice(0, 8)}</b>; expiry is about 5 minutes out.</li>
                        <li>There is <b>no</b> Permit, spender or token amount. <code>risks</code> is empty or harmless. If it was intercepted, stop.</li>
                      </ul>} />
                    <PasteBox id="preview-out" label="Paste the preview output" value={previewOut} onChange={setPreviewOut} hint="We read requestId from it and check it's this exact challenge. Stays in your browser." />
                    <ParsedLine p={pPreview} />
                    <AnimatePresence>{inlineErr(pPreview) && <ErrorExplainer err={inlineErr(pPreview)!} onFallback={() => setPath("onchain")} onRegenerate={() => regenerate()} />}</AnimatePresence>

                    <CommandBlock n={2} testId="cmd-execute" title="Sign it" stale={!!stale} staleReason={staleReason}
                      placeholder={pPreview?.kind !== "preview"}
                      cmd={pPreview?.kind === "preview" ? bawExecuteCommand(pPreview.requestId) : "baw sign-message execute --requestId <requestId from step 1> --json"}
                      why="Signs the message you just previewed. If baw answers PENDING_CONFIRMATION, approve it in your Binance App." />
                    <PasteBox id="exec-out" label="Paste the execute output" value={execOut} onChange={setExecOut} />
                    <ParsedLine p={pExec} />
                    <AnimatePresence>{inlineErr(pExec) && <ErrorExplainer err={inlineErr(pExec)!} onFallback={() => setPath("onchain")} onRegenerate={() => regenerate()} />}</AnimatePresence>

                    <AnimatePresence>
                      {pendingOrder && (
                        <motion.div key="result" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="space-y-3 overflow-hidden">
                          <CommandBlock n={3} testId="cmd-result" title="Fetch the signature after approving in the App" cmd={bawResultCommand(pendingOrder)} stale={!!stale} staleReason={staleReason}
                            why="Run this after you approve the request in the Binance App. Repeat until status is COMPLETED." />
                          <PasteBox id="result-out" label="Paste the result output" value={resultOut} onChange={setResultOut} />
                          <ParsedLine p={pResult} />
                          <AnimatePresence>{inlineErr(pResult) && <ErrorExplainer err={inlineErr(pResult)!} onFallback={() => setPath("onchain")} onRegenerate={() => regenerate()} />}</AnimatePresence>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    <div className="rounded-2xl border border-line bg-white/[0.02] p-3 sm:p-4">
                      <div className="mb-2 text-sm font-semibold">{pendingOrder ? 4 : 3} · Signature</div>
                      <div className="grid grid-cols-[1fr_90px] gap-2">
                        <div><label className="label" htmlFor="ob-sig">signature</label><input id="ob-sig" className="input hash mt-1" value={sig} onChange={(e) => setSig(e.target.value)} placeholder="filled from the output, or paste it" spellCheck={false} autoComplete="off" /></div>
                        <div><label className="label" htmlFor="ob-rec">recovery</label><input id="ob-rec" className="input hash mt-1" value={rec} onChange={(e) => setRec(e.target.value)} placeholder="01" spellCheck={false} autoComplete="off" /></div>
                      </div>
                      {sigCheck && !sigCheck.ok && <p data-testid="sig-hint" className="mt-2 text-xs text-amber-warn">{explainAuthError(sigCheck.code).title}: {explainAuthError(sigCheck.code).fix}</p>}
                      <Button className="mt-3 w-full" size="lg" disabled={!!stale || !sig.trim()} loading={busy === "verify"} onClick={submitSignature}><ShieldCheck className="h-4 w-4" />Verify signature</Button>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <label className="inline-flex cursor-pointer items-center gap-2 text-ink-dim"><input type="checkbox" checked={autoRenew} onChange={(e) => setAutoRenew(e.target.checked)} className="accent-[var(--color-signal)]" />Auto-renew the challenge when it expires</label>
                      <button type="button" onClick={() => { setErr(null); setPath("onchain"); }} className="inline-flex items-center gap-1 text-signal hover:underline"><Link2 className="h-3.5 w-3.5" />Signing keeps failing? Use the on-chain proof</button>
                    </div>
                  </div>
                ) : (
                  <OnchainPath ch={ch} shell={shell} stale={stale} staleReason={staleReason} contractsPending={contractsPending}
                    pOcPreview={pOcPreview} pOcExec={pOcExec} ocPreviewOut={ocPreviewOut} ocExecOut={ocExecOut} setOcPreviewOut={setOcPreviewOut} setOcExecOut={setOcExecOut}
                    busy={busy === "verify"} onVerify={() => verify({ mode: "onchain" })} onBack={() => { setErr(null); setPath("signature"); }} inlineErr={inlineErr} onRegenerate={() => regenerate()} />
                )}

                <button type="button" onClick={() => { setErr(null); setCh(null); setStale(null); setStep(1); }} className="text-xs text-ink-faint hover:text-ink">← use a different wallet</button>
              </motion.section>
            )}

            {/* ------------------------------------------------ 3 verify */}
            {step === 3 && (
              <motion.section key="verify" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="grid place-items-center gap-5 py-10 text-center" aria-live="polite">
                {verified ? (
                  <>
                    <CommittedBadge label="Agent ID verified" />
                    <div><div className="text-2xl font-semibold">{verified.agentName}</div><p className="mt-1 text-sm text-ink-dim">{verified.isNew ? "Account created" : "Signed in"} · method <code>{verified.method}</code></p></div>
                  </>
                ) : (
                  <>
                    <Loader2 className="h-8 w-8 animate-spin text-signal motion-reduce:animate-none" />
                    <ul className="space-y-2 text-left text-sm text-ink-dim">
                      <li className="flex items-center gap-2"><LiveDot />Checking the signature against your stored challenge (nonce, expiry, website)</li>
                      <li className="flex items-center gap-2"><LiveDot />Confirming the wallet still holds your Agent ID</li>
                      <li className="flex items-center gap-2"><LiveDot />Linking exactly one Agent ID to one account</li>
                    </ul>
                  </>
                )}
              </motion.section>
            )}

            {/* ------------------------------------------------ 4 passkey */}
            {step === 4 && (
              <motion.section key="pk" {...slide} className="space-y-4" aria-labelledby="pk-h">
                <div className="flex items-center gap-3">
                  <span className="grid h-11 w-11 place-items-center rounded-2xl bg-signal-dim text-signal"><Fingerprint className="h-6 w-6" /></span>
                  <div><h2 id="pk-h" className="text-xl font-semibold">{passkeyDone ? "Passkey added" : "Add a passkey for next time"}</h2><p className="text-sm text-ink-dim">You're signed in as <b className="text-ink">{verified?.agentName}</b>.</p></div>
                </div>
                <ul className="space-y-2 text-sm text-ink-dim">
                  <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-up" />Next time, sign in with Face ID, Touch ID, Windows Hello or a security key. No CLI needed.</li>
                  <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-up" />Passkeys give <b className="text-ink">social access only</b>. Publishing theses, trades and on-chain actions still need a fresh wallet proof.</li>
                  <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-up" />The private key stays on your device. ATLAS stores only the public key.</li>
                </ul>
                <InfoNote><b className="text-ink">Recovery:</b> lost the device? Sign in with your Agent ID wallet again (these same steps), then remove the old passkey in Settings → Security and add a new one. ATLAS can't recover passkeys and will never ask for your seed phrase to "restore" an account.</InfoNote>
                <AnimatePresence>{err && <ErrorExplainer err={err} onRetry={addPasskey} onDismiss={() => setErr(null)} />}</AnimatePresence>
                <div className="flex flex-wrap justify-end gap-2">
                  {passkeyDone ? (
                    <Button size="lg" onClick={async () => router.push(await pathAfterSignIn())}>Continue<ArrowRight className="h-4 w-4" /></Button>
                  ) : (
                    <>
                      <Button variant="ghost" onClick={async () => router.push(await pathAfterSignIn())}>Skip for now</Button>
                      <Button size="lg" loading={busy === "passkey"} onClick={addPasskey}><KeyRound className="h-4 w-4" />Add a passkey</Button>
                    </>
                  )}
                </div>
              </motion.section>
            )}
          </AnimatePresence>
        </div>
      </Card>

      {/* ------------------------------------------------ sidebar */}
      <aside className="space-y-4">
        <Card hover={false} className="p-5">
          <div className="flex items-center gap-2 text-sm font-semibold"><Fingerprint className="h-4 w-4 text-signal" />Returning? Use your passkey</div>
          <p className="mt-1 text-xs text-ink-dim">If you've verified before and added a passkey, skip the CLI.</p>
          <Button variant="outline" className="mt-3 w-full" loading={busy === "passkey" && step < 4} onClick={passkeyLogin}><Fingerprint className="h-4 w-4" />Sign in with a passkey</Button>
          {step < 2 && err && ["PASSKEY_CANCELLED", "PASSKEY_UNKNOWN", "PASSKEY_REJECTED", "CHALLENGE_INVALID", "ACCOUNT_UNAVAILABLE"].includes(err.code) && (
            <p className="mt-2 text-xs text-ink-dim" data-testid="passkey-recovery">No passkey on this device? Verify with <code>baw</code> using these steps, then add one at the end.</p>
          )}
        </Card>
        <Card hover={false} className="p-5">
          <div className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="h-4 w-4 text-emerald-up" />What ATLAS checks</div>
          <ul className="mt-2 space-y-1.5 text-xs text-ink-dim">
            {["EIP-712 message bound to this website and chain", "Single-use nonce, 5-minute expiry", "Signer = your wallet (smart wallets via ERC-1271)", "Live Agent ID ownership on the official registry", "One Agent ID ↔ one ATLAS account", "Rejected attempts burn the challenge", "20 sign-in attempts per minute"].map((t) => (
              <li key={t} className="flex gap-2"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-signal" />{t}</li>
            ))}
          </ul>
        </Card>
        <SafetyNote />
        <Link href="/onboarding/guide" className="flex items-center gap-2 text-xs text-signal hover:underline"><BookOpen className="h-3.5 w-3.5" />Judges: how to verify this flow</Link>
      </aside>
    </div>
  );
}

function PreItem({ n, title, cmd, why, done }: { n: number; title: string; cmd: string; why: React.ReactNode; done: boolean }) {
  return (
    <div className="relative">
      <CommandBlock n={n} title={title} cmd={cmd} why={why} />
      <span className="absolute right-3 top-3" aria-label={done ? "checked" : "not checked yet"}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.span key={String(done)} initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.4, opacity: 0 }} className="block">
            {done ? <CheckCircle2 className="h-4 w-4 text-emerald-up" /> : <Circle className="h-4 w-4 text-ink-faint" />}
          </motion.span>
        </AnimatePresence>
      </span>
    </div>
  );
}

function OnchainPath(p: {
  ch: any; shell: ShellKind; stale: Stale; staleReason?: string; contractsPending: boolean; pOcPreview: BawParse | null; pOcExec: BawParse | null;
  ocPreviewOut: string; ocExecOut: string; setOcPreviewOut: (v: string) => void; setOcExecOut: (v: string) => void;
  busy: boolean; onVerify: () => void; onBack: () => void; onRegenerate: () => void; inlineErr: (x: BawParse | null) => Explained | null;
}) {
  const fb = p.ch.onchainFallback;
  if (p.contractsPending) {
    return (
      <div className="space-y-3" data-testid="onchain-pending">
        <ContractsPending what="The on-chain proof (registerIdentity)" />
        <ol className="space-y-2 opacity-50" aria-label="On-chain proof steps (available after deployment)">
          {["Check Developer Mode: baw wallet settings --json", "Preview registerIdentity(commitment) with baw contract-call preview", "Execute it from your Agent ID wallet (no value, no approval)", "Come back and press verify"].map((t, i) => (
            <li key={t} className="flex gap-2 rounded-xl border border-dashed border-line p-3 text-xs text-ink-dim"><span className="num text-ink-faint">{i + 1}</span>{t}</li>
          ))}
        </ol>
        <p className="text-xs text-ink-dim">The verify button stays disabled until the ATLAS Identity Registry is deployed and verified on BscScan. Nothing is faked in the meantime.</p>
        <Button variant="outline" className="w-full" onClick={p.onBack}><Terminal className="h-4 w-4" />Back to the signature path</Button>
      </div>
    );
  }
  const txHash = p.pOcExec?.kind === "broadcast" ? p.pOcExec.txHash : null;
  return (
    <div className="space-y-3" data-testid="onchain-path">
      <CommandBlock n={1} title="Check Developer Mode" cmd={fb.baw.checkDevMode} why={'Must show "devMode": { "enabled": true }.'} stale={!!p.stale} staleReason={p.staleReason} />
      <CommandBlock n={2} testId="oc-preview" title="Preview the registerIdentity call" cmd={fb.baw.preview} stale={!!p.stale} staleReason={p.staleReason}
        why="Simulates the transaction and runs Binance's risk checks. Nothing is sent yet."
        check={<ul className="list-disc space-y-1 pl-4">
          <li><code>parsedTx</code> calls <b>registerIdentity(bytes32)</b> on <b className="hash">{fb.transaction.to}</b> (the ATLAS Identity Registry shown at /api/config and on BscScan).</li>
          <li>value is <b>0</b>. No <code>allowanceChanges</code>, no <code>authorityChanges</code>.</li>
          <li>The commitment is single-use and tied to this challenge ({p.ch.loginId.slice(0, 8)}…).</li>
        </ul>} />
      <PasteBox id="oc-preview-out" label="Paste the preview output" value={p.ocPreviewOut} onChange={p.setOcPreviewOut} />
      <ParsedLine p={p.pOcPreview} />
      <AnimatePresence>{p.inlineErr(p.pOcPreview) && <ErrorExplainer err={p.inlineErr(p.pOcPreview)!} onRegenerate={p.onRegenerate} />}</AnimatePresence>
      <CommandBlock n={3} testId="oc-execute" title="Send it from your wallet" stale={!!p.stale} staleReason={p.staleReason} placeholder={p.pOcPreview?.kind !== "preview"}
        cmd={p.pOcPreview?.kind === "preview" ? bawExecuteCommand(p.pOcPreview.requestId, "contract-call") : fb.baw.execute}
        why="Broadcasts the transaction (gas only, a few cents of BNB). If baw says PENDING_CONFIRMATION, approve it in the Binance App. This counts as an on-chain ATLAS interaction." />
      <PasteBox id="oc-exec-out" label="Paste the execute output (optional)" value={p.ocExecOut} onChange={p.setOcExecOut} />
      <ParsedLine p={p.pOcExec} />
      <AnimatePresence>{p.inlineErr(p.pOcExec) && <ErrorExplainer err={p.inlineErr(p.pOcExec)!} onRegenerate={p.onRegenerate} />}</AnimatePresence>
      <Button size="lg" className="w-full" disabled={!!p.stale} loading={p.busy} onClick={p.onVerify}><Sparkles className="h-4 w-4" />I've sent it — verify on-chain</Button>
      {txHash && <p className="text-center text-xs text-ink-dim">ATLAS will look up your commitment on-chain; it does not trust the pasted hash.</p>}
      <Button variant="ghost" className="w-full" onClick={p.onBack}><Wallet className="h-4 w-4" />Back to the signature path</Button>
    </div>
  );
}
