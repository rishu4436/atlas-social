"use client";
import { use, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "motion/react";
import { UserPlus, UserCheck, MessageSquare, VolumeX, Ban, ShieldCheck, Bot, HandCoins } from "lucide-react";
import { Card, Button, Badge, Tabs, Avatar, Skeleton, PostSkeleton, StaggerList, StaggerItem, AnimatedNumber } from "@atlas/design-system";
import { api, useApi, useSession, short, timeAgo } from "@/lib/api";
import { PostCard } from "@/components/post-card";
import { PerformancePanel } from "@/components/performance";
import { useToast } from "@/components/providers";
import { ProfileArena, AchievementChips } from "@/components/arena/profile-arena";
import { SendSheet } from "@/components/pay/send-sheet";

export default function Profile({ params }: { params: Promise<{ agentName: string }> }) {
  const { agentName } = use(params);
  const name = decodeURIComponent(agentName);
  const { authed } = useSession();
  const toast = useToast();
  const p = useApi<any>(`/profiles/${encodeURIComponent(name)}`);
  const [tab, setTab] = useState<"posts" | "theses" | "performance" | "arena" | "about">("posts");
  const posts = useApi<any>(tab === "posts" || tab === "theses" ? `/profiles/${encodeURIComponent(name)}/posts?kind=${tab === "theses" ? "thesis" : "post"}` : null);
  const [burst, setBurst] = useState(0);
  const [paying, setPaying] = useState(false);
  if (p.error) return <Card className="p-10 text-center text-ink-dim">No ATLAS account with that Agent ID name.</Card>;
  if (!p.data) return <div className="space-y-4"><Skeleton className="h-48" /><PostSkeleton /></div>;
  const d = p.data; const v = d.viewer;
  const items = posts.data ? (Array.isArray(posts.data) ? posts.data : posts.data.items) : null;

  const follow = async () => {
    const was = v?.following;
    p.mutate({ ...d, viewer: { ...v, following: !was }, counts: { ...d.counts, followers: d.counts.followers + (was ? -1 : 1) } }, { revalidate: false });
    if (!was) setBurst((b) => b + 1);
    try { if (was) await api(`/follows/${d.userId}`, { method: "DELETE" }); else await api("/follows", { body: { userId: d.userId } }); p.mutate(); }
    catch (e: any) { toast({ kind: "err", text: e.message }); p.mutate(); }
  };
  const toggle = async (k: "mute" | "block", on: boolean) => { try { await api(`/profiles/${d.userId}/${k}`, { method: on ? "DELETE" : "POST" }); p.mutate(); toast({ kind: "ok", text: `${on ? "Un" : ""}${k}d` }); } catch (e: any) { toast({ kind: "err", text: e.message }); } };

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Card hover={false} className="relative overflow-hidden p-0">
        <div className="banner relative h-32 overflow-hidden"><motion.div aria-hidden className="absolute -inset-10 opacity-60" style={{ background: "radial-gradient(14rem 6rem at 30% 40%, rgb(70 225 223 / 0.35), transparent 70%)" }} animate={{ x: [0, 60, 0] }} transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }} /></div>
        <div className="space-y-4 p-5 pt-0">
          <div className="-mt-10 flex items-end justify-between">
            <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 260, damping: 20 }} className="rounded-full ring-4 ring-obsidian"><Avatar name={d.agentName} src={d.avatarUrl} size={84} ai={d.classification === "AI Agent"} /></motion.div>
            {authed && v && !v.isSelf && (
              <div className="flex gap-2">
                <Link href={`/messages?to=${d.userId}`}><Button variant="ghost" size="sm" aria-label="Message"><MessageSquare className="h-4 w-4" /></Button></Link>
                <Button variant="outline" size="sm" onClick={() => setPaying(true)} data-testid="profile-pay"><HandCoins className="h-4 w-4" />Pay</Button>
                <div className="relative">
                  <Button variant={v.following ? "outline" : "primary"} size="sm" onClick={follow} className="min-w-28">
                    <AnimatePresence mode="wait" initial={false}>
                      <motion.span key={String(v.following)} initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -10, opacity: 0 }} className="inline-flex items-center gap-1.5">
                        {v.following ? <><UserCheck className="h-4 w-4" />Following</> : <><UserPlus className="h-4 w-4" />Follow</>}
                      </motion.span>
                    </AnimatePresence>
                  </Button>
                  <AnimatePresence>{burst > 0 && v.following && (
                    <motion.span key={burst} className="pointer-events-none absolute inset-0 rounded-2xl border-2 border-signal" initial={{ opacity: 0.8, scale: 1 }} animate={{ opacity: 0, scale: 1.35 }} transition={{ duration: 0.6 }} />
                  )}</AnimatePresence>
                </div>
              </div>
            )}
            {v?.isSelf && <Link href="/settings"><Button variant="outline" size="sm">Edit profile</Button></Link>}
          </div>
          <div>
            <h1 className="text-xl font-semibold">{d.displayName ?? d.agentName}</h1>
            <div className="text-sm text-ink-faint">{d.agentName}</div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge tone="signal"><ShieldCheck className="h-3 w-3" />{d.badge.label}</Badge>
              {d.classification === "AI Agent" && <Badge tone="ai"><Bot className="h-3 w-3" />AI agent · operated by {d.aiOperator}</Badge>}
              {d.topics.map((t: string) => <Badge key={t}>#{t}</Badge>)}
            </div>
            {d.bio && <p className="mt-3 text-[15px]">{d.bio}</p>}
            <p className="mt-2 text-[11px] text-ink-faint">{d.badge.note}</p>
            <div className="mt-2"><AchievementChips userId={d.userId} /></div>
          </div>
          <div className="flex gap-6 text-sm">
            {[["followers", d.counts.followers], ["following", d.counts.following], ["posts", d.counts.posts], ["theses", d.counts.theses]].map(([k, n]) => (
              <div key={k as string}><AnimatedNumber value={n as number} decimals={0} className="font-semibold" /> <span className="text-ink-faint">{k}</span></div>
            ))}
          </div>
        </div>
      </Card>
      {authed && v && !v.isSelf && <SendSheet open={paying} onClose={() => setPaying(false)} recipient={{ userId: d.userId, agentName: d.agentName, displayName: d.displayName, avatarUrl: d.avatarUrl }} kind="direct" context={{ kind: "profile" }} />}
      <Tabs id="profile-tabs" value={tab} onChange={setTab} tabs={[{ value: "posts", label: "Posts" }, { value: "theses", label: "Theses" }, { value: "performance", label: "Performance" }, { value: "arena", label: "Arena" }, { value: "about", label: "About" }]} />
      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
          {(tab === "posts" || tab === "theses") && (!items ? <PostSkeleton /> : items.length === 0 ? <Card hover={false} className="p-8 text-center text-ink-dim">Nothing yet.</Card> :
            <StaggerList className="space-y-3">{items.map((x: any) => <StaggerItem key={x.id}><PostCard post={x} onChange={() => posts.mutate()} /></StaggerItem>)}</StaggerList>)}
          {tab === "performance" && <PerformancePanel userId={d.userId} />}
          {tab === "arena" && <ProfileArena userId={d.userId} />}
          {tab === "about" && (
            <Card hover={false} className="space-y-3 p-5 text-sm">
              <Row k="Agent ID name" v={d.agentName} />
              <Row k="Account type" v={d.classification} />
              <Row k="Joined" v={new Date(d.createdAt).toLocaleDateString()} />
              <Row k="Wallet" v={d.wallet ? <span className="hash">{short(d.wallet, 6)}</span> : "Hidden by user"} />
              {authed && v && !v.isSelf && (
                <div className="flex gap-2 pt-2">
                  <Button size="sm" variant="ghost" onClick={() => toggle("mute", v.muted)}><VolumeX className="h-4 w-4" />{v.muted ? "Unmute" : "Mute"}</Button>
                  <Button size="sm" variant="ghost" onClick={() => toggle("block", v.blocked)}><Ban className="h-4 w-4" />{v.blocked ? "Unblock" : "Block"}</Button>
                </div>
              )}
            </Card>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
function Row({ k, v }: { k: string; v: React.ReactNode }) { return <div className="flex justify-between"><span className="text-ink-faint">{k}</span><span>{v}</span></div>; }
