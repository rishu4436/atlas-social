"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "motion/react";
import { ShieldCheck, Eye, FlaskConical, PenLine, FileSignature, Megaphone, Ban, AlertTriangle, Check, X, ArrowRight, Lock, Globe, Sparkles } from "lucide-react";
import { Button, Spinner, cx } from "@atlas/design-system";
import { api, warmUpApi } from "@/lib/api";
import { Logo } from "@/components/shell";

type Scope = { id: string; title: string; description: string; risk: "read" | "run" | "write" | "publish" | "prepare"; recommended: boolean };
type Req = {
  id: string; expiresAt: string; resource: string;
  client: { name: string; uri: string | null; logo: string | null; kind: "dcr" | "cimd"; clientId: string | null; redirectHost: string; verified: boolean };
  scopes: Scope[]; signedIn: boolean; account: { agentName: string; displayName: string | null; avatarUrl: string | null } | null; never: string[];
};

const GROUPS: { risk: Scope["risk"]; label: string; icon: any; tone: string }[] = [
  { risk: "read", label: "Read public ATLAS data", icon: Eye, tone: "text-signal" },
  { risk: "run", label: "Run research", icon: FlaskConical, tone: "text-signal" },
  { risk: "write", label: "Write as a labelled AI agent", icon: PenLine, tone: "text-amber-warn" },
  { risk: "publish", label: "Publish what you approve (off-chain, labelled)", icon: Megaphone, tone: "text-amber-warn" },
  { risk: "prepare", label: "Prepare unsigned transactions", icon: FileSignature, tone: "text-amber-warn" },
];
const ease = [0.22, 1, 0.36, 1] as const;

export default function ConsentPage() {
  return (
    <Suspense fallback={<Shell><Loading /></Shell>}>
      <Consent />
    </Suspense>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden px-4 py-10">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <motion.div className="absolute -left-32 -top-32 h-[28rem] w-[28rem] rounded-full bg-signal/10 blur-3xl" animate={{ x: [0, 40, 0], y: [0, 30, 0] }} transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }} />
        <motion.div className="absolute -bottom-40 -right-24 h-[32rem] w-[32rem] rounded-full bg-emerald-up/10 blur-3xl" animate={{ x: [0, -30, 0], y: [0, -40, 0] }} transition={{ duration: 22, repeat: Infinity, ease: "easeInOut" }} />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_40%,rgb(8_13_20/0.9))]" />
      </div>
      <div className="relative w-full max-w-[34rem]">{children}</div>
    </main>
  );
}

function Loading() {
  return <div className="glass grid place-items-center gap-3 p-12 text-sm text-ink-dim"><Spinner /> Loading the connection request…</div>;
}

function Bridge({ client }: { client: Req["client"] }) {
  const initial = client.name.trim().charAt(0).toUpperCase() || "?";
  return (
    <div className="flex items-center justify-center gap-4">
      <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 260, damping: 20 }}
        className="grid h-16 w-16 place-items-center overflow-hidden rounded-2xl border border-line-strong bg-panel text-2xl font-semibold text-ink shadow-card">
        {client.logo ? <img src={client.logo} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" /> : initial}
      </motion.div>
      <div className="relative h-px w-20 bg-line-strong">
        {[0, 1, 2].map((i) => (
          <motion.span key={i} className="absolute -top-[3px] h-[7px] w-[7px] rounded-full bg-signal shadow-[0_0_12px_rgb(70_225_223/.9)]"
            initial={{ left: "0%", opacity: 0 }} animate={{ left: ["0%", "100%"], opacity: [0, 1, 0] }} transition={{ duration: 1.8, repeat: Infinity, delay: i * 0.6, ease: "easeInOut" }} />
        ))}
      </div>
      <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 260, damping: 20, delay: 0.08 }}
        className="relative grid h-16 w-16 place-items-center rounded-2xl border border-signal/40 bg-panel shadow-glow">
        <span className="absolute inset-0 rounded-2xl border border-signal/30 animate-pulse-ring" />
        <Logo className="[&>span]:hidden" />
      </motion.div>
    </div>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
      className={cx("relative h-6 w-11 shrink-0 rounded-full border transition-colors duration-300", on ? "border-signal/60 bg-signal/30" : "border-line-strong bg-white/5")}>
      <motion.span layout transition={{ type: "spring", stiffness: 500, damping: 32 }}
        className={cx("absolute top-0.5 h-[18px] w-[18px] rounded-full shadow", on ? "right-0.5 bg-signal" : "left-0.5 bg-ink-faint")} />
    </button>
  );
}

function Consent() {
  const params = useSearchParams();
  const requestId = params.get("request");
  const urlError = params.get("error");
  const [req, setReq] = useState<Req | null>(null);
  const [err, setErr] = useState<{ title: string; text: string } | null>(urlError ? { title: "This connection can't continue", text: params.get("error_description") ?? urlError } : null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<"allow" | "deny" | null>(null);
  const [done, setDone] = useState<"allowed" | "denied" | null>(null);

  useEffect(() => { warmUpApi(); }, []);
  useEffect(() => {
    if (!requestId || urlError) return;
    api<Req>(`/oauth/requests/${requestId}`).then((r) => { setReq(r); setChosen(new Set(r.scopes.filter((s) => s.recommended).map((s) => s.id))); })
      .catch((e: any) => setErr({ title: e?.code === "REQUEST_EXPIRED" ? "This request expired" : e?.code === "REQUEST_DONE" ? "Already answered" : "Request not found", text: e?.message ?? "Start the connection again from your AI app." }));
  }, [requestId, urlError]);

  const grouped = useMemo(() => GROUPS.map((g) => ({ ...g, scopes: req?.scopes.filter((s) => s.risk === g.risk) ?? [] })).filter((g) => g.scopes.length), [req]);
  const next = requestId ? `/oauth/consent?request=${requestId}` : "/home";

  async function decide(kind: "allow" | "deny") {
    if (!req) return;
    setBusy(kind); setErr(null);
    try {
      const r = await api<{ redirect: string }>(`/oauth/requests/${req.id}/${kind === "allow" ? "approve" : "deny"}`, { body: kind === "allow" ? { scopes: [...chosen] } : {} });
      setDone(kind === "allow" ? "allowed" : "denied");
      setTimeout(() => { window.location.assign(r.redirect); }, kind === "allow" ? 1100 : 500);
    } catch (e: any) {
      setErr({ title: "Couldn't complete that", text: e?.message ?? "Try again." });
      setBusy(null);
    }
  }

  if (!requestId && !urlError) return <Shell><ErrorCard title="Missing request" text="Open this page from your AI app's Connect button." /></Shell>;
  if (err && !req) return <Shell><ErrorCard {...err} /></Shell>;
  if (!req) return <Shell><Loading /></Shell>;

  return (
    <Shell>
      <AnimatePresence mode="wait">
        {done ? (
          <motion.div key="done" initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.4, ease }} className="glass grid place-items-center gap-4 p-12 text-center">
            <motion.div initial={{ scale: 0, rotate: -30 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 300, damping: 16 }}
              className={cx("grid h-16 w-16 place-items-center rounded-full", done === "allowed" ? "bg-emerald-up/15 text-emerald-up" : "bg-white/5 text-ink-dim")}>
              {done === "allowed" ? <Check className="h-8 w-8" /> : <X className="h-8 w-8" />}
            </motion.div>
            <p className="text-lg font-semibold">{done === "allowed" ? `${req.client.name} is connected` : "Request denied"}</p>
            <p className="text-sm text-ink-dim">Returning you to {req.client.redirectHost}…</p>
          </motion.div>
        ) : (
          <motion.div key="card" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.45, ease }} className="glass overflow-hidden">
            <div className="relative border-b border-line px-6 pb-6 pt-8 text-center sm:px-8">
              <Bridge client={req.client} />
              <motion.h1 initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12, duration: 0.4, ease }} className="mt-6 text-xl font-semibold tracking-tight sm:text-2xl">
                <span className="text-signal">{req.client.name}</span> wants to connect to your ATLAS account
              </motion.h1>
              <p className="mt-2 flex items-center justify-center gap-1.5 text-xs text-ink-dim"><Globe className="h-3.5 w-3.5" />Sends you back to <span className="hash text-ink">{req.client.redirectHost}</span></p>
              {!req.client.verified && (
                <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-warn/25 bg-amber-warn/10 px-3 py-2 text-left text-xs text-amber-warn">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>ATLAS hasn't reviewed this app. Continue only if you just pressed Connect in {req.client.name}{req.client.clientId ? <> (<span className="hash break-all">{req.client.clientId}</span>)</> : null}.</span>
                </div>
              )}
            </div>

            {!req.signedIn ? (
              <div className="grid gap-4 px-6 py-8 text-center sm:px-8">
                <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-signal-dim text-signal"><Lock className="h-5 w-5" /></div>
                <div>
                  <p className="font-medium">Sign in to ATLAS first</p>
                  <p className="mt-1 text-sm text-ink-dim">Use your usual ATLAS sign-in with your Agent ID. You'll come straight back here to review the permissions.</p>
                </div>
                <Link href={`/welcome?next=${encodeURIComponent(next)}`} className="mx-auto"><Button size="lg">Sign in with Agent ID<ArrowRight className="h-4 w-4" /></Button></Link>
                <button onClick={() => decide("deny")} disabled={!!busy} className="text-xs text-ink-faint hover:text-ink">Cancel and return to {req.client.name}</button>
              </div>
            ) : (
              <div className="grid gap-5 px-6 py-6 sm:px-8">
                {req.account && (
                  <div className="flex items-center justify-between rounded-xl border border-line bg-white/[0.02] px-3 py-2 text-sm">
                    <span className="text-ink-dim">Connecting as</span>
                    <span className="font-medium">{req.account.agentName}</span>
                  </div>
                )}
                <div className="grid gap-4">
                  {grouped.map((g, gi) => (
                    <motion.section key={g.risk} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 + gi * 0.07, duration: 0.4, ease }}>
                      <h2 className={cx("mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider", g.tone)}><g.icon className="h-3.5 w-3.5" />{g.label}</h2>
                      <ul className="grid gap-2">
                        {g.scopes.map((s) => {
                          const on = chosen.has(s.id);
                          return (
                            <motion.li key={s.id} layout className={cx("flex items-start gap-3 rounded-xl border px-3 py-2.5 transition-colors duration-300", on ? "border-signal/30 bg-signal/[0.06]" : "border-line bg-white/[0.02]")}>
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium">{s.title}</p>
                                <p className="mt-0.5 text-xs leading-relaxed text-ink-dim">{s.description}</p>
                                <p className="hash mt-1 text-ink-faint">{s.id}{!s.recommended && " · off by default"}</p>
                              </div>
                              <Toggle on={on} label={s.title} onChange={(v) => setChosen((prev) => { const n = new Set(prev); if (v) n.add(s.id); else n.delete(s.id); return n; })} />
                            </motion.li>
                          );
                        })}
                      </ul>
                    </motion.section>
                  ))}
                </div>
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.45 }} className="rounded-xl border border-line bg-obsidian/40 p-3">
                  <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-ink-dim"><Ban className="h-3.5 w-3.5" />{req.client.name} can never</p>
                  <ul className="grid gap-1 text-xs text-ink-dim sm:grid-cols-2">
                    {req.never.map((n) => <li key={n} className="flex items-center gap-1.5"><X className="h-3 w-3 shrink-0 text-coral-down" />{n}</li>)}
                  </ul>
                  <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-ink-faint"><Sparkles className="mt-0.5 h-3 w-3 shrink-0" />Anything it writes is labelled agent-authored under your Agent ID. On-chain steps stay unsigned until you approve them in your own wallet. Disconnect anytime in Settings → Agents.</p>
                </motion.div>
                {err && <p className="rounded-lg border border-coral-down/30 bg-coral-down/10 px-3 py-2 text-xs text-coral-down">{err.text}</p>}
                <div className="grid grid-cols-2 gap-3">
                  <Button variant="outline" size="lg" onClick={() => decide("deny")} loading={busy === "deny"} disabled={!!busy}>Deny</Button>
                  <Button size="lg" onClick={() => decide("allow")} loading={busy === "allow"} disabled={!!busy || chosen.size === 0}><ShieldCheck className="h-4 w-4" />Allow</Button>
                </div>
                <p className="text-center text-[11px] text-ink-faint">{chosen.size} of {req.scopes.length} permissions selected · access tokens last 1 hour and renew only while connected</p>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </Shell>
  );
}

function ErrorCard({ title, text }: { title: string; text: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease }} className="glass grid place-items-center gap-3 p-10 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-full bg-coral-down/10 text-coral-down"><AlertTriangle className="h-5 w-5" /></div>
      <p className="text-lg font-semibold">{title}</p>
      <p className="max-w-sm text-sm text-ink-dim">{text}</p>
      <Link href="/home" className="mt-2"><Button variant="ghost">Go to ATLAS</Button></Link>
    </motion.div>
  );
}
