"use client";
import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ShieldAlert, Gavel, Users, FileText, Link2, Flag } from "lucide-react";
import { Card, Button, Badge, Skeleton, AnimatedNumber, StaggerList, StaggerItem } from "@atlas/design-system";
import { api, useApi, useSession, timeAgo } from "@/lib/api";
import { useToast } from "@/components/providers";

export default function Admin() {
  const { session } = useSession();
  const toast = useToast();
  const isMod = session?.roles?.some((r: string) => r === "moderator" || r === "admin");
  const q = useApi<any>(isMod ? "/admin/reviews" : null, { refreshInterval: 20_000 });
  const [reason, setReason] = useState<Record<string, string>>({});
  if (!isMod) return <Card className="mx-auto max-w-xl p-10 text-center text-ink-dim"><ShieldAlert className="mx-auto mb-2 h-6 w-6" />Moderators only.</Card>;
  const act = async (r: any, action: string) => {
    const why = reason[r.target_id] || `${action} after review`;
    try { const res = await api("/admin/reviews/action", { body: { targetKind: r.target_kind, targetId: r.target_id, action, reason: why } }); toast({ kind: "ok", text: res.note ?? `${action} applied` }); q.mutate(); }
    catch (e: any) { toast({ kind: "err", text: e.message }); }
  };
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <h1 className="text-2xl font-semibold">Moderation</h1>
      {q.data && (
        <StaggerList className="grid grid-cols-2 gap-3 sm:grid-cols-5">{[["Users", q.data.stats.users, Users], ["Agent IDs", q.data.stats.agent_ids, ShieldAlert], ["Posts", q.data.stats.posts, FileText], ["On-chain theses", q.data.stats.onchain_theses, Link2], ["Open reports", q.data.stats.open_reports, Flag]].map(([k, v, I]: any) => (
          <StaggerItem key={k}><Card className="p-4"><I className="h-4 w-4 text-signal" /><AnimatedNumber value={v} decimals={0} className="num mt-2 block text-2xl font-semibold" /><div className="label">{k}</div></Card></StaggerItem>
        ))}</StaggerList>
      )}
      <p className="text-xs text-ink-faint">Removing a post hides it on ATLAS only. On-chain commitments are immutable and remain on the public chain; removed posts say so.</p>
      {!q.data ? <Skeleton className="h-48" /> : (<>
        <div className="label">Report queue ({q.data.reports.length})</div>
        <AnimatePresence>{q.data.reports.map((r: any) => (
          <motion.div key={r.target_id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 40 }}>
            <Card hover={false} className="space-y-3 p-4">
              <div className="flex flex-wrap items-center gap-2"><Badge tone="down">{r.reports} reports</Badge>{r.reasons.map((x: string) => <Badge key={x}>{x}</Badge>)}<Badge>{r.target_kind}</Badge>{r.post?.onchain && <Badge tone="signal">on-chain</Badge>}<span className="ml-auto text-xs text-ink-faint">{timeAgo(r.first_at)}</span></div>
              {r.post && <p className="text-sm"><b className="font-medium">{r.post.author}</b> <span className="text-ink-dim">· {r.post.kind} · {r.post.status}</span><span className="mt-1 block text-ink-dim">{r.post.body}</span></p>}
              <input className="input" placeholder="Reason (shown to the user and appealable)" value={reason[r.target_id] ?? ""} onChange={(e) => setReason({ ...reason, [r.target_id]: e.target.value })} />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="danger" onClick={() => act(r, "remove")}><Gavel className="h-4 w-4" />Remove</Button>
                <Button size="sm" variant="outline" onClick={() => act(r, "limit")}>Limit reach</Button>
                <Button size="sm" variant="ghost" onClick={() => act(r, "dismiss")}>Dismiss</Button>
                <Button size="sm" variant="ghost" onClick={() => act(r, "restore")}>Restore</Button>
              </div>
            </Card>
          </motion.div>
        ))}</AnimatePresence>
        {q.data.reports.length === 0 && <Card hover={false} className="p-6 text-center text-sm text-ink-dim">Queue is empty.</Card>}
        <div className="label pt-2">Appeals ({q.data.appeals.length})</div>
        {q.data.appeals.map((a: any) => (
          <Card key={a.id} hover={false} className="space-y-2 p-4 text-sm">
            <div><b className="font-medium">{a.agent_name}</b> appeals <Badge tone="warn">{a.action}</Badge> on {a.target_kind}</div>
            <p className="text-ink-dim">Original reason: {a.reason}</p><p>{a.body}</p>
            <div className="flex gap-2"><Button size="sm" onClick={async () => { await api(`/admin/appeals/${a.id}`, { body: { decision: "reversed" } }); q.mutate(); }}>Reverse action</Button><Button size="sm" variant="ghost" onClick={async () => { await api(`/admin/appeals/${a.id}`, { body: { decision: "upheld" } }); q.mutate(); }}>Uphold action</Button></div>
          </Card>
        ))}
      </>)}
    </div>
  );
}
