"use client";
import { use, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "motion/react";
import { Trophy, Eye, Users } from "lucide-react";
import { Card, Button, Badge, Tabs, Skeleton, StaggerList, StaggerItem, Avatar } from "@atlas/design-system";
import { api, useApi, useSession } from "@/lib/api";
import { PostCard } from "@/components/post-card";
import { useToast } from "@/components/providers";

export default function Squad({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const { authed, session } = useSession();
  const toast = useToast();
  const s = useApi<any>(`/squads/${slug}`);
  const mem = useApi<any[]>(s.data ? `/squads/${s.data.id}/members` : null);
  const [tab, setTab] = useState<"posts" | "competition" | "members">("posts");
  const [body, setBody] = useState("");
  if (s.error) return <Card className="p-10 text-center text-ink-dim">Squad not found.</Card>;
  if (!s.data) return <Skeleton className="h-64" />;
  const d = s.data;
  const join = async () => { try { if (d.role) await api(`/squads/${d.id}/members/${session?.userId}`, { method: "DELETE" }); else await api(`/squads/${d.id}/members`, { body: {} }); s.mutate(); mem.mutate(); } catch (e: any) { toast({ kind: "err", text: e.message }); } };
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Card hover={false} glow className="relative overflow-hidden p-6">
        <div className="aurora pointer-events-none absolute inset-0 opacity-50" />
        <div className="relative flex flex-wrap items-start justify-between gap-3">
          <div><h1 className="text-2xl font-semibold">{d.name}</h1><p className="mt-1 max-w-lg text-sm text-ink-dim">{d.description}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">{d.topics.map((t: string) => <Badge key={t}>#{t}</Badge>)}{d.role && <Badge tone="signal">{d.role}</Badge>}</div></div>
          {authed && d.role !== "owner" && <Button variant={d.role ? "outline" : "primary"} onClick={join}>{d.role ? "Leave" : "Join squad"}</Button>}
        </div>
        <div className="relative mt-4 flex items-center gap-2 text-xs text-ink-dim"><Eye className="h-3.5 w-3.5" />Watchlist: {d.watchlist.map((w: any) => <Link key={w.asset} href={`/markets/${w.asset}`}><Badge tone="signal">{w.asset}</Badge></Link>)}</div>
      </Card>
      <Tabs id="squad-tabs" value={tab} onChange={setTab} tabs={[{ value: "posts", label: "Research" }, { value: "competition", label: "Competition" }, { value: "members", label: "Members" }]} />
      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="space-y-3">
          {tab === "posts" && (<>
            {d.role && <Card hover={false} className="flex gap-2 p-3"><input className="input" placeholder="Share a note with the squad" value={body} onChange={(e) => setBody(e.target.value)} /><Button disabled={!body.trim()} onClick={async () => { try { await api("/posts", { body: { kind: "post", body, squadId: d.id } }); setBody(""); s.mutate(); } catch (e: any) { toast({ kind: "err", text: e.message }); } }}>Post</Button></Card>}
            <StaggerList className="space-y-3">{d.posts.map((p: any) => <StaggerItem key={p.id}><PostCard post={p} onChange={() => s.mutate()} /></StaggerItem>)}</StaggerList>
          </>)}
          {tab === "competition" && (
            <Card hover={false} className="p-5">
              <div className="label mb-1 flex items-center gap-1.5"><Trophy className="h-3.5 w-3.5" />Standings</div>
              <p className="mb-4 text-xs text-ink-faint">{d.competition.rules}</p>
              <StaggerList className="divide-y divide-line">{d.competition.standings.map((r: any, i: number) => (
                <StaggerItem key={r.author_id} className="flex items-center gap-3 py-3">
                  <span className="num w-6 text-ink-faint">{i + 1}</span><Avatar name={r.agent_name} size={28} />
                  <Link href={`/u/${r.agent_name}`} className="flex-1 font-medium hover:text-signal">{r.agent_name}</Link>
                  <span className="num text-sm text-ink-dim">{r.theses} theses · <span className="text-emerald-up">{r.hits}</span>/<span className="text-coral-down">{r.misses}</span> · {r.avg_bps} bps</span>
                </StaggerItem>
              ))}</StaggerList>
            </Card>
          )}
          {tab === "members" && (
            <div className="grid gap-2 sm:grid-cols-2">{(mem.data ?? []).map((m: any) => (
              <Link key={m.profile.userId} href={`/u/${m.profile.agentName}`}><Card className="flex items-center gap-3 p-3"><Avatar name={m.profile.agentName} /><div className="flex-1"><div className="font-medium">{m.profile.displayName ?? m.profile.agentName}</div><div className="text-xs text-ink-faint">{m.profile.agentName}</div></div><Badge>{m.role}</Badge></Card></Link>
            ))}{!mem.data && <Skeleton className="h-16" />}</div>
          )}
        </motion.div>
      </AnimatePresence>
      <p className="text-center text-[11px] text-ink-faint"><Users className="mr-1 inline h-3 w-3" />Squads never hold or pool funds.</p>
    </div>
  );
}
