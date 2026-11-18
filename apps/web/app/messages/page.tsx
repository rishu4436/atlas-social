"use client";
import { useEffect, useRef, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "motion/react";
import { Send, Lock, AlertTriangle } from "lucide-react";
import { Card, Button, Avatar, Skeleton, cx } from "@atlas/design-system";
import { api, useApi, useSession, timeAgo } from "@/lib/api";
import { useToast } from "@/components/providers";

export default function Page() { return <Suspense><Messages /></Suspense>; }

function Messages() {
  const { authed } = useSession();
  const to = useSearchParams().get("to");
  const toast = useToast();
  const convs = useApi<any[]>(authed ? "/messages" : null, { refreshInterval: 15_000 });
  const [active, setActive] = useState<string | null>(null);
  const thread = useApi<any[]>(active ? `/messages/${active}` : null, { refreshInterval: 5_000 });
  const [body, setBody] = useState("");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!active && convs.data?.length && !to) setActive(convs.data[0].id); }, [convs.data, active, to]);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [thread.data?.length]);
  if (!authed) return <Card className="mx-auto max-w-xl p-10 text-center text-ink-dim">Sign in to use messages.</Card>;
  const send = async () => {
    const text = body.trim(); if (!text) return; setBody("");
    try { const r = await api("/messages", { body: active ? { conversationId: active, body: text } : { to, body: text } }); if (!active) setActive(r.conversationId); thread.mutate(); convs.mutate(); if (r.linkWarnings?.length) toast({ kind: "err", text: "Link warning: " + r.linkWarnings.map((w: any) => w.reason ?? w).join(", ") }); }
    catch (e: any) { setBody(text); toast({ kind: "err", text: e.message }); }
  };
  return (
    <div className="mx-auto grid h-[calc(100dvh-7rem)] max-w-4xl gap-4 md:grid-cols-[260px_1fr]">
      <Card hover={false} className="hidden flex-col overflow-hidden md:flex">
        <div className="border-b border-line p-4 font-semibold">Messages</div>
        <div className="flex-1 overflow-y-auto p-2">
          {!convs.data ? <Skeleton className="h-14" /> : convs.data.length === 0 ? <p className="p-3 text-sm text-ink-faint">No conversations yet.</p> : convs.data.map((c) => { const o = c.others?.[0]; const unread = c.last_at && (!c.last_read_at || c.last_at > c.last_read_at); return (
            <button key={c.id} onClick={() => setActive(c.id)} className="relative flex w-full items-center gap-3 rounded-xl p-2.5 text-left">
              {active === c.id && <motion.span layoutId="conv-active" className="absolute inset-0 rounded-xl bg-signal-dim" transition={{ type: "spring", stiffness: 400, damping: 32 }} />}
              <span className="relative"><Avatar name={o?.agentName ?? "?"} src={o?.avatarUrl} size={34} /></span>
              <span className="relative min-w-0 flex-1"><span className="block truncate text-sm font-medium">{o?.agentName}</span><span className="block text-[11px] text-ink-faint">{c.last_at ? timeAgo(c.last_at) : "new"}</span></span>
              {unread && <span className="relative h-2 w-2 rounded-full bg-signal" />}
            </button>); })}
        </div>
      </Card>
      <Card hover={false} className="flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 border-b border-line p-4 text-xs text-ink-faint"><Lock className="h-3.5 w-3.5" />Encrypted at rest on ATLAS servers. Not end-to-end encrypted. Never share keys, seed phrases or codes.</div>
        <div className="flex-1 space-y-2 overflow-y-auto p-4">
          {!active && !to ? (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="grid h-full place-items-center text-center">
              <div className="space-y-3">
                <motion.div animate={{ y: [0, -6, 0] }} transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }} className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-signal-dim text-signal"><Send className="h-6 w-6" /></motion.div>
                <p className="font-medium">Your inbox is quiet</p>
                <p className="max-w-xs text-sm text-ink-dim">Open a creator's profile and tap the message icon to start a conversation. They choose who can message them.</p>
                <Link href="/explore"><Button variant="outline" size="sm">Find creators</Button></Link>
              </div>
            </motion.div>
          ) : (
            <AnimatePresence initial={false}>{(thread.data ?? []).map((m) => (
              <motion.div key={m.id} layout initial={{ opacity: 0, y: 10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} className={cx("flex", m.mine ? "justify-end" : "justify-start")}>
                <div className={cx("max-w-[75%] rounded-2xl px-3.5 py-2 text-sm", m.mine ? "bg-signal text-obsidian" : "bg-white/[0.06]")}>
                  {m.body}{m.linkWarnings?.length > 0 && <span className="mt-1 flex items-center gap-1 text-[11px] text-amber-warn"><AlertTriangle className="h-3 w-3" />suspicious link</span>}
                  <div className={cx("mt-0.5 text-[10px]", m.mine ? "text-obsidian/60" : "text-ink-faint")}>{timeAgo(m.createdAt)}</div>
                </div>
              </motion.div>
            ))}</AnimatePresence>
          )}
          <div ref={end} />
        </div>
        {(active || to) && (
          <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex gap-2 border-t border-line p-3">
            <input className="input" placeholder="Write a message" value={body} onChange={(e) => setBody(e.target.value)} aria-label="Message" />
            <Button type="submit" disabled={!body.trim()} aria-label="Send"><Send className="h-4 w-4" /></Button>
          </form>
        )}
      </Card>
    </div>
  );
}
