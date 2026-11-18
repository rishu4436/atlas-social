"use client";
import Link from "next/link";
import { motion } from "motion/react";
import { Bell, CheckCheck, Heart, UserPlus, MessageCircle, AtSign, Gauge, Shield, Link2 } from "lucide-react";
import { Card, Button, Avatar, Skeleton, StaggerList, StaggerItem, cx } from "@atlas/design-system";
import { api, useApi, useSession, timeAgo, refresh } from "@/lib/api";

const ICON: Record<string, any> = { "follow.new": UserPlus, "reaction.new": Heart, "comment.new": MessageCircle, mention: AtSign, "thesis.reviewed": Shield, "thesis.challenged": Shield, "outcome.proposed": Gauge, "outcome.challenged": Gauge, "outcome.finalized": Gauge, "message.new": MessageCircle };
const TEXT: Record<string, string> = { "follow.new": "followed you", "reaction.new": "reacted to your post", "comment.new": "commented on your post", mention: "mentioned you", "thesis.reviewed": "reviewed your thesis", "thesis.challenged": "challenged evidence on your thesis", "outcome.proposed": "An outcome was proposed for your thesis", "outcome.challenged": "An outcome was challenged", "outcome.finalized": "Your thesis outcome is final", "squad.invite": "invited you to a squad", "message.new": "sent you a message", system: "System notice" };

export default function Notifications() {
  const { authed } = useSession();
  const n = useApi<any[]>(authed ? "/notifications" : null, { refreshInterval: 20_000 });
  if (!authed) return <Card className="mx-auto max-w-xl p-10 text-center text-ink-dim">Sign in to see notifications.</Card>;
  const href = (x: any) => x.kind.startsWith("thesis") || x.kind.startsWith("outcome") ? `/thesis/${x.subject_id}` : x.kind === "follow.new" ? `/u/${x.actor_name}` : x.kind === "message.new" ? "/messages" : x.kind === "squad.invite" ? "/squads" : x.actor_name ? `/u/${x.actor_name}` : "/home";
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between"><h1 className="text-2xl font-semibold">Notifications</h1>
        <Button size="sm" variant="ghost" onClick={async () => { await api("/notifications/read", { body: {} }); n.mutate(); refresh("/notifications?unread=true"); }}><CheckCheck className="h-4 w-4" />Mark all read</Button></div>
      {!n.data ? <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16" />)}</div> : n.data.length === 0 ? <Card hover={false} className="p-10 text-center text-ink-dim"><Bell className="mx-auto mb-2 h-6 w-6" />All caught up.</Card> : (
        <StaggerList className="space-y-2">{n.data.map((x) => { const I = ICON[x.kind] ?? Link2; return (
          <StaggerItem key={x.id}><Link href={href(x)}><Card className={cx("flex items-center gap-3 p-3", !x.read_at && "border-signal/25")}>
            <div className="relative">{x.actor_name ? <Avatar name={x.actor_name} src={x.actor_avatar} size={36} /> : <div className="grid h-9 w-9 place-items-center rounded-full bg-signal-dim"><I className="h-4 w-4 text-signal" /></div>}
              <span className="absolute -bottom-1 -right-1 grid h-5 w-5 place-items-center rounded-full bg-panel ring-2 ring-obsidian"><I className="h-3 w-3 text-signal" /></span></div>
            <div className="min-w-0 flex-1 text-sm">{x.actor_name && <b className="font-medium">{x.actor_name} </b>}<span className="text-ink-dim">{TEXT[x.kind] ?? x.kind}</span>{x.data?.stance && <span className="text-ink-faint"> · {x.data.stance}</span>}{x.data?.outcome && <span className="text-ink-faint"> · {x.data.outcome}</span>}</div>
            <span className="text-xs text-ink-faint">{timeAgo(x.created_at)}</span>
            {!x.read_at && <motion.span className="h-2 w-2 rounded-full bg-signal shadow-glow" initial={{ scale: 0 }} animate={{ scale: 1 }} />}
          </Card></Link></StaggerItem>); })}</StaggerList>
      )}
    </div>
  );
}
