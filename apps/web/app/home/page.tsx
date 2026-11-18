"use client";
import Link from "next/link";
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Clock, PenSquare } from "lucide-react";
import { Tabs, PostSkeleton, StaggerList, StaggerItem, Avatar, Card } from "@atlas/design-system";
import { useApi, useSession } from "@/lib/api";
import { PostCard } from "@/components/post-card";

type Tab = "following" | "foryou" | "verified" | "chronological";

export default function HomeFeed() {
  const { authed, session } = useSession();
  const [tab, setTab] = useState<Tab>("foryou");
  const eff = !authed && tab === "following" ? "foryou" : tab;
  const feed = useApi<any>(`/feed?tab=${eff}`, { refreshInterval: 45_000 });
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="sticky top-0 z-30 -mx-3 bg-obsidian/70 px-3 pb-3 pt-1 backdrop-blur-xl lg:mx-0 lg:px-0">
        <div className="flex items-center gap-2">
          <Tabs id="feed" className="flex-1" value={tab} onChange={setTab} tabs={[
            { value: "following", label: "Following" }, { value: "foryou", label: "For You" }, { value: "verified", label: "Verified" },
          ]} />
          <motion.button whileTap={{ scale: 0.9 }} aria-label="Chronological feed" aria-pressed={tab === "chronological"} onClick={() => setTab(tab === "chronological" ? "foryou" : "chronological")}
            className={`grid h-11 w-11 place-items-center rounded-2xl border ${tab === "chronological" ? "border-signal/40 bg-signal-dim text-signal" : "border-line text-ink-dim hover:text-ink"}`}>
            <Clock className="h-4 w-4" />
          </motion.button>
        </div>
        <AnimatePresence mode="wait">
          <motion.p key={tab} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-2 px-1 text-xs text-ink-faint">
            {tab === "foryou" ? "Ranked by evidence, freshness, relationships and topics. Never by profit or follower count." : tab === "verified" ? "On-chain theses, verified trade evidence and labelled AI research." : tab === "following" ? (authed ? "Latest from accounts you follow." : "Sign in to see who you follow.") : "Everything, newest first. No personalisation."}
          </motion.p>
        </AnimatePresence>
      </div>

      {authed && (
        <Link href="/compose">
          <Card className="flex items-center gap-3 p-4">
            <Avatar name={session.profile?.agentName ?? "me"} size={36} />
            <span className="flex-1 text-ink-faint">Share research or publish a verifiable thesis…</span>
            <PenSquare className="h-4 w-4 text-signal" />
          </Card>
        </Link>
      )}

      <AnimatePresence mode="wait">
        {!feed.data ? (
          <motion.div key="sk" exit={{ opacity: 0 }} className="space-y-4">{[0, 1, 2].map((i) => <PostSkeleton key={i} />)}</motion.div>
        ) : (
          <motion.div key={eff} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <StaggerList className="space-y-4" gap={0.06}>
              {feed.data.items.length === 0 && <Card className="p-10 text-center text-ink-dim">Nothing here yet.</Card>}
              {feed.data.items.map((p: any) => <StaggerItem key={p.id}><PostCard post={p} onChange={() => feed.mutate()} /></StaggerItem>)}
            </StaggerList>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
