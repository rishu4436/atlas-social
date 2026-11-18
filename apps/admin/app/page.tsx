"use client";
import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ShieldAlert, Gavel, Users, FileText, Link2, Flag, LogOut } from "lucide-react";
import { Card, Button, Badge, Skeleton, AnimatedNumber, StaggerList, StaggerItem } from "@atlas/design-system";
import { api, useApi, useSession, timeAgo, refresh } from "@/lib/api";
import { useToast } from "@/components/providers";

/** Standalone moderator console. Same API, same session model: moderators sign in with their Agent ID wallet. */
export default function Console() {
  const { session, authed } = useSession();
  const isMod = session?.roles?.some((r: string) => r === "moderator" || r === "admin");
  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-signal" /><h1 className="text-xl font-semibold">ATLAS Moderation Console</h1></div>
        {authed && <Button size="sm" variant="ghost" onClick={async () => { await api("/auth/logout", { body: {} }); refresh("/auth/session"); }}><LogOut className="h-4 w-4" />{session.profile?.agentName}</Button>}
      </header>
      {!authed ? <Login /> : !isMod ? <Card hover={false} className="p-8 text-center text-ink-dim">This Agent ID has no moderator role.</Card> : <Queue />}
    </div>
  );
}

function Login() {
  const [wallet, setWallet] = useState(""); const [ch, setCh] = useState<any>(null); const [sig, setSig] = useState(""); const [err, setErr] = useState<string | null>(null);
  return (
    <Card hover={false} className="mx-auto max-w-lg space-y-4 p-6">
      <p className="text-sm text-ink-dim">Moderators sign in with their Agent ID wallet. There is no password, QR code or pairing code.</p>
      {!ch ? (<>
        <input className="input hash" aria-label="Agent ID wallet" placeholder="0x…" value={wallet} onChange={(e) => setWallet(e.target.value)} />
        <Button className="w-full" disabled={!/^0x[0-9a-fA-F]{40}$/.test(wallet)} onClick={async () => { setErr(null); try { setCh(await api("/auth/challenge", { body: { wallet } })); } catch (e: any) { setErr(e.message); } }}>Get challenge</Button>
      </>) : (<>
        <pre className="hash overflow-x-auto rounded-xl bg-black/30 p-3 text-[11px]">{`${ch.wallet.baw.preview}\n${ch.wallet.baw.execute}\n${ch.wallet.baw.result}`}</pre>
        <input className="input hash" aria-label="Signature" placeholder="signature 0x…" value={sig} onChange={(e) => setSig(e.target.value)} />
        <Button className="w-full" onClick={async () => { setErr(null); try { await api("/auth/verify", { body: { loginId: ch.loginId, mode: "signature", signature: sig.trim() } }); refresh("/auth/session"); } catch (e: any) { setErr(e.message); } }}>Verify</Button>
      </>)}
      {err && <p className="text-sm text-coral-down">{err}</p>}
    </Card>
  );
}

function Queue() {
  const toast = useToast();
  const q = useApi<any>("/admin/reviews", { refreshInterval: 15_000 });
  const [reason, setReason] = useState<Record<string, string>>({});
  const act = async (r: any, action: string) => {
    try { const res = await api("/admin/reviews/action", { body: { targetKind: r.target_kind, targetId: r.target_id, action, reason: reason[r.target_id] || `${action} after review` } }); toast({ kind: "ok", text: res.note ?? `${action} applied` }); q.mutate(); }
    catch (e: any) { toast({ kind: "err", text: e.message }); }
  };
  if (!q.data) return <Skeleton className="h-64" />;
  return (
    <div className="space-y-5">
      <StaggerList className="grid grid-cols-2 gap-3 sm:grid-cols-5">{[["Users", q.data.stats.users, Users], ["Agent IDs", q.data.stats.agent_ids, ShieldAlert], ["Posts", q.data.stats.posts, FileText], ["On-chain theses", q.data.stats.onchain_theses, Link2], ["Open reports", q.data.stats.open_reports, Flag]].map(([k, v, I]: any) => (
        <StaggerItem key={k}><Card className="p-4"><I className="h-4 w-4 text-signal" /><AnimatedNumber value={v} decimals={0} className="num mt-2 block text-2xl font-semibold" /><div className="label">{k}</div></Card></StaggerItem>
      ))}</StaggerList>
      <p className="text-xs text-ink-faint">Removing content hides it on ATLAS only; on-chain commitments are immutable. Every action is logged and appealable.</p>
      <AnimatePresence>{q.data.reports.map((r: any) => (
        <motion.div key={r.target_id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 40 }}>
          <Card hover={false} className="space-y-3 p-4">
            <div className="flex flex-wrap items-center gap-2"><Badge tone="down">{r.reports} reports</Badge>{r.reasons.map((x: string) => <Badge key={x}>{x}</Badge>)}{r.post?.onchain && <Badge tone="signal">on-chain</Badge>}<span className="ml-auto text-xs text-ink-faint">{timeAgo(r.first_at)}</span></div>
            {r.post && <p className="text-sm"><b>{r.post.author}</b> <span className="text-ink-dim">· {r.post.kind} · {r.post.status}</span><span className="mt-1 block text-ink-dim">{r.post.body}</span></p>}
            <input className="input" placeholder="Reason" value={reason[r.target_id] ?? ""} onChange={(e) => setReason({ ...reason, [r.target_id]: e.target.value })} />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="danger" onClick={() => act(r, "remove")}><Gavel className="h-4 w-4" />Remove</Button>
              <Button size="sm" variant="outline" onClick={() => act(r, "limit")}>Limit</Button>
              <Button size="sm" variant="ghost" onClick={() => act(r, "dismiss")}>Dismiss</Button>
              <Button size="sm" variant="ghost" onClick={() => act(r, "restore")}>Restore</Button>
            </div>
          </Card>
        </motion.div>
      ))}</AnimatePresence>
      {q.data.reports.length === 0 && <Card hover={false} className="p-6 text-center text-sm text-ink-dim">Report queue is empty.</Card>}
      {q.data.appeals.map((a: any) => (
        <Card key={a.id} hover={false} className="space-y-2 p-4 text-sm">
          <div><b>{a.agent_name}</b> appeals <Badge tone="warn">{a.action}</Badge></div><p className="text-ink-dim">{a.reason}</p><p>{a.body}</p>
          <div className="flex gap-2"><Button size="sm" onClick={async () => { await api(`/admin/appeals/${a.id}`, { body: { decision: "reversed" } }); q.mutate(); }}>Reverse</Button><Button size="sm" variant="ghost" onClick={async () => { await api(`/admin/appeals/${a.id}`, { body: { decision: "upheld" } }); q.mutate(); }}>Uphold</Button></div>
        </Card>
      ))}
    </div>
  );
}
