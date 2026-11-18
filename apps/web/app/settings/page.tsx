"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import { startRegistration } from "@simplewebauthn/browser";
import { User, Lock, Bell, MonitorSmartphone, Fingerprint, Scale, LogOut, Trash2, ShieldCheck } from "lucide-react";
import { Card, Button, Badge, Tabs, Skeleton, StaggerList, StaggerItem, cx } from "@atlas/design-system";
import { api, useApi, useSession, timeAgo, short, refresh } from "@/lib/api";
import { StepUp } from "@/components/step-up";
import { useToast } from "@/components/providers";

type T = "profile" | "privacy" | "notifications" | "security" | "appeals";

export default function Settings() {
  const { authed, session } = useSession();
  const [tab, setTab] = useState<T>("profile");
  if (!authed) return <Card className="mx-auto max-w-xl p-10 text-center text-ink-dim">Sign in to manage settings.</Card>;
  const icons = { profile: User, privacy: Lock, notifications: Bell, security: MonitorSmartphone, appeals: Scale };
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="flex items-center justify-between"><h1 className="text-2xl font-semibold">Settings</h1>{session.identity && <Badge tone="signal"><ShieldCheck className="h-3 w-3" />{session.profile?.agentName} · <span className="hash">{short(session.identity.wallet)}</span></Badge>}</div>
      <div className="overflow-x-auto"><Tabs id="settings" value={tab} onChange={setTab} tabs={(Object.keys(icons) as T[]).map((k) => { const I = icons[k]; return { value: k, label: <span className="inline-flex items-center gap-1.5 capitalize"><I className="h-3.5 w-3.5" />{k}</span> }; })} /></div>
      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
          {tab === "profile" && <ProfileForm />}
          {tab === "privacy" && <Privacy userId={session.userId} />}
          {tab === "notifications" && <NotifPrefs />}
          {tab === "security" && <Security session={session} />}
          {tab === "appeals" && <Appeals />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function ProfileForm() {
  const toast = useToast();
  const me = useApi<any>("/profiles/me");
  const [f, setF] = useState<any>(null);
  useEffect(() => { if (me.data && !f) setF({ displayName: me.data.displayName ?? "", bio: me.data.bio ?? "", topics: (me.data.topics ?? []).join(", "), isAiAgent: me.data.classification === "AI Agent", aiOperator: me.data.aiOperator ?? "" }); }, [me.data, f]);
  if (!f) return <Skeleton className="h-64" />;
  return (
    <Card hover={false} className="space-y-3 p-5">
      <div><label className="label">Display name</label><input className="input mt-1" maxLength={50} value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} /></div>
      <div><label className="label">Bio</label><textarea className="input mt-1" maxLength={300} value={f.bio} onChange={(e) => setF({ ...f, bio: e.target.value })} /></div>
      <div><label className="label">Topics</label><input className="input mt-1" value={f.topics} onChange={(e) => setF({ ...f, topics: e.target.value })} /></div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-[#46E1DF]" checked={f.isAiAgent} onChange={(e) => setF({ ...f, isAiAgent: e.target.checked })} />This account is an AI agent (labelled publicly)</label>
      <AnimatePresence>{f.isAiAgent && <motion.input initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="input" placeholder="Operator (who is responsible for this agent)" value={f.aiOperator} onChange={(e) => setF({ ...f, aiOperator: e.target.value })} />}</AnimatePresence>
      <Button onClick={async () => { try { await api("/profiles/me", { method: "PATCH", body: { displayName: f.displayName || undefined, bio: f.bio, topics: f.topics.split(",").map((t: string) => t.trim().toLowerCase()).filter(Boolean), isAiAgent: f.isAiAgent, aiOperator: f.isAiAgent ? f.aiOperator : undefined } }); toast({ kind: "ok", text: "Profile saved" }); me.mutate(); refresh("/auth/session"); } catch (e: any) { toast({ kind: "err", text: e.message }); } }}>Save</Button>
    </Card>
  );
}

function Toggle({ on, onChange, label, desc }: { on: boolean; onChange: (v: boolean) => void; label: string; desc?: string }) {
  return (
    <button role="switch" aria-checked={on} onClick={() => onChange(!on)} className="flex w-full items-center justify-between gap-4 py-3 text-left">
      <span><span className="block text-sm font-medium">{label}</span>{desc && <span className="block text-xs text-ink-faint">{desc}</span>}</span>
      <span className={cx("relative h-6 w-11 shrink-0 rounded-full transition-colors", on ? "bg-signal" : "bg-white/10")}>
        <motion.span layout transition={{ type: "spring", stiffness: 600, damping: 32 }} className={cx("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow", on ? "right-0.5" : "left-0.5")} />
      </span>
    </button>
  );
}

function Privacy({ userId }: { userId: string }) {
  const toast = useToast();
  const p = useApi<any>(`/profiles/${userId}/privacy`);
  if (!p.data) return <Skeleton className="h-48" />;
  const save = async (patch: any) => { p.mutate({ ...p.data, ...patch }, { revalidate: false }); try { await api(`/profiles/${userId}/privacy`, { method: "PATCH", body: patch }); } catch (e: any) { toast({ kind: "err", text: e.message }); p.mutate(); } };
  return (
    <Card hover={false} className="divide-y divide-line px-5">
      <Toggle on={p.data.showWallet} onChange={(v) => save({ showWallet: v })} label="Show my wallet on my profile" desc="Off by default. On-chain theses still reveal your address on explorers." />
      <Toggle on={p.data.showFollows} onChange={(v) => save({ showFollows: v })} label="Show who I follow" />
      <Toggle on={p.data.personalizedFeed} onChange={(v) => save({ personalizedFeed: v })} label="Personalised For You feed" desc="Off = For You falls back to chronological." />
      <div className="flex items-center justify-between py-3"><span className="text-sm font-medium">Who can message me</span>
        <select className="rounded-xl border border-line bg-panel px-3 py-1.5 text-sm" value={p.data.dmPolicy} onChange={(e) => save({ dmPolicy: e.target.value })}><option value="everyone">Everyone</option><option value="following">People I follow</option><option value="nobody">Nobody</option></select></div>
    </Card>
  );
}

function NotifPrefs() {
  const n = useApi<any>("/notifications/preferences");
  if (!n.data) return <Skeleton className="h-48" />;
  const set = async (k: string, on: boolean) => { const muted = on ? n.data.muted.filter((x: string) => x !== k) : [...n.data.muted, k]; n.mutate({ ...n.data, muted }, { revalidate: false }); await api("/notifications/preferences", { method: "PUT", body: { muted } }); };
  return <Card hover={false} className="divide-y divide-line px-5">{n.data.kinds.map((k: string) => <Toggle key={k} on={!n.data.muted.includes(k)} onChange={(v) => set(k, v)} label={k} />)}</Card>;
}

function Security({ session }: { session: any }) {
  const toast = useToast();
  const router = useRouter();
  const s = useApi<any[]>("/auth/sessions");
  const pk = useApi<any[]>("/auth/passkeys");
  const [stepUp, setStepUp] = useState(false);
  const fresh = session.freshWalletUntil && session.freshWalletUntil * 1000 > Date.now();
  const addPasskey = async () => {
    if (!fresh) return setStepUp(true);
    try { const opts = await api("/auth/passkeys/register/options", { body: {} }); const resp = await startRegistration({ optionsJSON: opts }); await api("/auth/passkeys/register/verify", { body: { response: resp, name: navigator.platform || "Passkey" } }); pk.mutate(); toast({ kind: "ok", text: "Passkey added (social access only)" }); }
    catch (e: any) { if (e.code === "STEP_UP_REQUIRED") setStepUp(true); else toast({ kind: "err", text: e.message }); }
  };
  return (
    <div className="space-y-4">
      <Card hover={false} className="space-y-3 p-5">
        <div className="flex items-center justify-between"><div className="label">Active sessions</div><Badge tone={fresh ? "up" : "neutral"}>{fresh ? "wallet verified recently" : "no recent wallet proof"}</Badge></div>
        {!s.data ? <Skeleton className="h-20" /> : <StaggerList className="space-y-2">{s.data.map((x) => (
          <StaggerItem key={x.id} className="flex items-center justify-between rounded-xl bg-black/25 p-3 text-sm">
            <span><span className="font-medium">{x.auth_method}</span>{x.current && <Badge tone="signal" className="ml-2">this device</Badge>}<span className="block max-w-xs truncate text-xs text-ink-faint">{x.user_agent} · active {timeAgo(x.last_seen_at)}</span></span>
            {!x.current && <Button size="sm" variant="ghost" onClick={async () => { await api(`/auth/sessions/${x.id}`, { method: "DELETE" }); s.mutate(); }}>Revoke</Button>}
          </StaggerItem>
        ))}</StaggerList>}
        <div className="flex gap-2 pt-1">
          <Button size="sm" variant="outline" onClick={async () => { await api("/auth/logout", { body: {} }); await refresh("/auth/session"); router.push("/welcome"); }}><LogOut className="h-4 w-4" />Sign out</Button>
          <Button size="sm" variant="danger" onClick={async () => { await api("/auth/logout", { body: { all: true } }); await refresh("/auth/session"); router.push("/welcome"); }}>Sign out everywhere</Button>
        </div>
      </Card>
      <Card hover={false} className="space-y-3 p-5">
        <div className="flex items-center justify-between"><div className="label">Passkeys</div><Button size="sm" onClick={addPasskey}><Fingerprint className="h-4 w-4" />Add passkey</Button></div>
        <p className="text-xs text-ink-faint">Passkeys give quick social access (posting, follows, messages). Theses, trades and security changes always require a fresh Agent ID wallet proof.</p>
        {(pk.data ?? []).map((p) => (
          <div key={p.id} className="flex items-center justify-between rounded-xl bg-black/25 p-3 text-sm"><span>{p.name}<span className="block text-xs text-ink-faint">added {timeAgo(p.created_at)}{p.last_used_at && ` · used ${timeAgo(p.last_used_at)}`}</span></span>
            <Button size="sm" variant="ghost" aria-label="Remove passkey" onClick={async () => { try { await api(`/auth/passkeys/${p.id}`, { method: "DELETE" }); pk.mutate(); } catch (e: any) { if (e.code === "STEP_UP_REQUIRED") setStepUp(true); else toast({ kind: "err", text: e.message }); } }}><Trash2 className="h-4 w-4" /></Button></div>
        ))}
      </Card>
      <StepUp open={stepUp} onClose={() => setStepUp(false)} onDone={() => { setStepUp(false); toast({ kind: "ok", text: "Wallet verified for 10 minutes" }); }} />
    </div>
  );
}

function Appeals() {
  const toast = useToast();
  const a = useApi<any>("/appeals");
  const [txt, setTxt] = useState<Record<string, string>>({});
  if (!a.data) return <Skeleton className="h-40" />;
  return (
    <Card hover={false} className="space-y-3 p-5">
      {a.data.actions.length === 0 ? <p className="text-sm text-ink-dim">No moderation actions on your account.</p> : a.data.actions.map((m: any) => { const ap = a.data.appeals.find((x: any) => x.action_id === m.id); return (
        <div key={m.id} className="space-y-2 rounded-xl bg-black/25 p-3 text-sm">
          <div className="flex justify-between"><span><Badge tone="warn">{m.action}</Badge> {m.target_kind}</span><span className="text-xs text-ink-faint">{timeAgo(m.created_at)}</span></div>
          <p className="text-ink-dim">Reason: {m.reason}</p>
          {ap ? <Badge>{`appeal ${ap.status}`}</Badge> : (<div className="flex gap-2"><input className="input" placeholder="Explain why this should be reversed (10+ chars)" value={txt[m.id] ?? ""} onChange={(e) => setTxt({ ...txt, [m.id]: e.target.value })} /><Button size="sm" disabled={(txt[m.id] ?? "").length < 10} onClick={async () => { try { await api("/appeals", { body: { actionId: m.id, body: txt[m.id] } }); a.mutate(); } catch (e: any) { toast({ kind: "err", text: e.message }); } }}>Appeal</Button></div>)}
        </div>); })}
    </Card>
  );
}
