"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "motion/react";
import { Search, Hash, Users } from "lucide-react";
import { Card, Avatar, Badge, Skeleton, StaggerList, StaggerItem, PostSkeleton } from "@atlas/design-system";
import { useApi } from "@/lib/api";
import { PostCard } from "@/components/post-card";

export default function Explore() {
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  const [topic, setTopic] = useState<string | null>(null);
  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  const ex = useApi<any>(`/explore?q=${encodeURIComponent(dq)}`, { keepPreviousData: true });
  const feed = useApi<any>(topic ? `/feed?tab=chronological&topic=${encodeURIComponent(topic)}` : null);
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
        <input className="input h-12 pl-11 text-base" placeholder="Search creators by .ai name, topics, squads" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
      </div>
      <p className="-mt-3 px-1 text-[11px] text-ink-faint">Wallet addresses are not searchable. Agent ID is not a lookup tool for other people's wallets.</p>
      {!ex.data ? <Skeleton className="h-40" /> : (
        <StaggerList className="space-y-5">
          <StaggerItem><Section title="Topics" icon={Hash}>
            <div className="flex flex-wrap gap-2">{ex.data.topics.map((t: any) => (
              <motion.button key={t.topic} whileHover={{ y: -2 }} whileTap={{ scale: 0.95 }} onClick={() => setTopic(topic === t.topic ? null : t.topic)} className={`rounded-full border px-3 py-1.5 text-sm ${topic === t.topic ? "border-signal/50 bg-signal-dim text-ink" : "border-line text-ink-dim"}`}>#{t.topic} <span className="num text-ink-faint">{t.posts}</span></motion.button>
            ))}{ex.data.topics.length === 0 && <span className="text-sm text-ink-faint">No topics match.</span>}</div>
          </Section></StaggerItem>
          <StaggerItem><Section title="Creators" icon={Users}>
            <div className="grid gap-2 sm:grid-cols-2">{ex.data.creators.map((c: any) => (
              <Link key={c.userId} href={`/u/${c.agentName}`}><Card className="flex items-center gap-3 p-3"><Avatar name={c.agentName} src={c.avatarUrl} ai={c.classification === "AI Agent"} /><div className="min-w-0"><div className="truncate font-medium">{c.displayName ?? c.agentName}</div><div className="truncate text-xs text-ink-faint">{c.agentName}</div></div></Card></Link>
            ))}{ex.data.creators.length === 0 && <span className="text-sm text-ink-faint">No creators match.</span>}</div>
          </Section></StaggerItem>
          <StaggerItem><Section title="Squads" icon={Users}>
            <div className="grid gap-2">{ex.data.squads.map((s: any) => <Link key={s.id} href={`/squads/${s.slug}`}><Card className="flex items-center justify-between p-3"><span className="font-medium">{s.name}</span><Badge>{s.members} members</Badge></Card></Link>)}</div>
          </Section></StaggerItem>
        </StaggerList>
      )}
      <AnimatePresence>{topic && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-3">
          <h2 className="text-lg font-semibold">#{topic}</h2>
          {!feed.data ? <PostSkeleton /> : <StaggerList className="space-y-3">{feed.data.items.map((p: any) => <StaggerItem key={p.id}><PostCard post={p} onChange={() => feed.mutate()} /></StaggerItem>)}</StaggerList>}
        </motion.div>
      )}</AnimatePresence>
    </div>
  );
}
function Section({ title, icon: I, children }: { title: string; icon: any; children: React.ReactNode }) {
  return <div><div className="label mb-2 flex items-center gap-1.5"><I className="h-3.5 w-3.5" />{title}</div>{children}</div>;
}
