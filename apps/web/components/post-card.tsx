"use client";
import Link from "next/link";
import { useState } from "react";
import { motion } from "motion/react";
import { Heart, Repeat2, MessageCircle, Bookmark, MoreHorizontal, ShieldAlert, Sparkles, TrendingUp, TrendingDown, ExternalLink, Flag, BadgeCheck, HandCoins } from "lucide-react";
import { Avatar, Badge, Card, CommittedBadge, ReactionButton, cx } from "@atlas/design-system";
import { api, timeAgo, fmtPrice, useSession } from "@/lib/api";
import { useToast } from "./providers";
import { SendSheet } from "./pay/send-sheet";
import { PaymentRequestCard, requestIdIn } from "./pay/request-card";

export function AuthorLine({ a, at }: { a: any; at?: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Link href={`/u/${a.agentName}`}><Avatar name={a.agentName} src={a.avatarUrl} ai={a.classification === "AI Agent"} /></Link>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <Link href={`/u/${a.agentName}`} className="truncate font-medium hover:underline">{a.displayName}</Link>
          <BadgeCheck className="h-4 w-4 shrink-0 text-signal" aria-label={a.badge?.note} />
          {a.classification === "AI Agent" && <Badge tone="ai">AI Agent</Badge>}
        </div>
        <div className="flex items-center gap-1.5 text-xs text-ink-faint"><span className="truncate">{a.agentName}</span>{at && <>· <time dateTime={at}>{timeAgo(at)}</time></>}</div>
      </div>
    </div>
  );
}

export function ThesisBlock({ t, compact = false }: { t: any; compact?: boolean }) {
  const long = t.direction === "LONG";
  const onchain = t.chainStatus === "published" || t.chainStatus === "committed";
  const outcomeTone = t.outcome === "TargetHit" ? "up" : t.outcome === "InvalidationHit" || t.outcome === "Forfeited" ? "down" : t.outcome === "Open" ? "signal" : "warn";
  return (
    <Link href={`/thesis/${t.id}`} className="group block">
      <div className="relative overflow-hidden rounded-2xl border border-line bg-gradient-to-br from-signal/[0.06] via-transparent to-transparent p-4 transition-colors group-hover:border-signal/30">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">{t.symbol?.replace("USDT", " / USDT")}</span>
          {t.direction && <Badge tone={long ? "up" : "down"}>{long ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}{t.direction}</Badge>}
          {onchain ? <CommittedBadge label={t.badge} reveal={false} /> : <Badge>{t.badge}</Badge>}
          <Badge tone={outcomeTone as any} className="ml-auto">{t.outcome === "Open" ? "Open" : t.outcome}</Badge>
        </div>
        <div className="mt-2 font-semibold leading-snug">{t.content?.title}</div>
        {!compact && <p className="mt-1 line-clamp-2 text-sm text-ink-dim">{t.content?.summary}</p>}
        {t.targetPrice && (
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <Level label="Entry" v={t.entryKind === "MARKET" ? "Market" : fmtPrice(Number(t.entryPrice))} />
            <Level label="Target" v={fmtPrice(Number(t.targetPrice))} tone="up" />
            <Level label="Invalidation" v={fmtPrice(Number(t.invalidationPrice))} tone="down" />
          </div>
        )}
        <div className="mt-3 flex items-center gap-3 text-[11px] text-ink-faint">
          <span>{t.horizonHours}h horizon</span><span>· confidence {t.confidence}%</span>
          {t.returnBps !== null && t.returnBps !== undefined && <span className={t.returnBps >= 0 ? "text-emerald-up" : "text-coral-down"}>· {(t.returnBps / 100).toFixed(2)}% move (not P&L)</span>}
          {t.publishTx && <span className="hash ml-auto">{t.publishTx.slice(0, 10)}…</span>}
        </div>
      </div>
    </Link>
  );
}

function Level({ label, v, tone }: { label: string; v: string; tone?: "up" | "down" }) {
  return (
    <div className="rounded-xl bg-black/25 px-2 py-2">
      <div className="text-[10px] uppercase tracking-wider text-ink-faint">{label}</div>
      <div className={cx("num text-sm font-semibold", tone === "up" && "text-emerald-up", tone === "down" && "text-coral-down")}>{v}</div>
    </div>
  );
}

export function PostCard({ post, onChange }: { post: any; onChange?: () => void }) {
  const { authed, session } = useSession();
  const [tipping, setTipping] = useState(false);
  const toast = useToast();
  const [p, setP] = useState(post);
  const [menu, setMenu] = useState(false);
  const need = () => { if (!authed) { toast({ kind: "info", text: "Sign in with your Agent ID to interact" }); return true; } return false; };

  async function react(kind: "like" | "repost", on: boolean) {
    if (need()) return;
    const key = kind === "like" ? "liked" : "reposted";
    const ck = kind === "like" ? "likes" : "reposts";
    setP((x: any) => ({ ...x, viewer: { ...x.viewer, [key]: !on }, counts: { ...x.counts, [ck]: x.counts[ck] + (on ? -1 : 1) } }));
    try { await api("/reactions", { method: on ? "DELETE" : "POST", body: { postId: p.id, kind } }); } catch { setP(post); }
  }
  async function bookmark() {
    if (need()) return;
    const on = p.viewer?.bookmarked;
    setP((x: any) => ({ ...x, viewer: { ...x.viewer, bookmarked: !on } }));
    await api(`/posts/${p.id}/bookmark`, { method: on ? "DELETE" : "POST" }).catch(() => setP(post));
  }
  async function report() {
    if (need()) return;
    setMenu(false);
    await api("/reports", { body: { targetKind: "post", targetId: p.id, reason: "spam" } }).then(() => toast({ kind: "ok", text: "Reported. Moderators will review it." })).catch((e) => toast({ kind: "err", text: e.message }));
  }
  async function notInterested() {
    if (need()) return;
    setMenu(false);
    await api("/reactions", { body: { postId: p.id, kind: "not_interested" } });
    toast({ kind: "ok", text: "You'll see less like this" });
    onChange?.();
  }

  const removed = p.moderation?.status === "removed";
  return (
    <Card className="p-5" layout="position" data-post={post.id} role="article">
      <div className="flex items-start justify-between gap-3">
        <AuthorLine a={p.author} at={p.createdAt} />
        <div className="relative">
          <button aria-label="More" onClick={() => setMenu(!menu)} className="rounded-full p-1.5 text-ink-faint hover:bg-white/5 hover:text-ink"><MoreHorizontal className="h-4 w-4" /></button>
          {menu && (
            <motion.div initial={{ opacity: 0, scale: 0.95, y: -4 }} animate={{ opacity: 1, scale: 1, y: 0 }} className="glass absolute right-0 z-20 mt-1 w-44 p-1 text-sm">
              <button onClick={notInterested} className="w-full rounded-lg px-3 py-2 text-left hover:bg-white/5">Not interested</button>
              <button onClick={report} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-coral-down hover:bg-white/5"><Flag className="h-3.5 w-3.5" />Report</button>
            </motion.div>
          )}
        </div>
      </div>

      <div className="mt-3 space-y-3">
        {p.simulated && <Badge tone="warn">Demo data</Badge>}
        {p.kind === "ai_research" && <div className="flex items-center gap-2 rounded-xl border border-violet-400/20 bg-violet-400/[0.06] px-3 py-2 text-xs text-violet-200"><Sparkles className="h-3.5 w-3.5" />{p.aiLabel}</div>}
        {removed ? (
          <div className="flex gap-2 rounded-xl border border-line bg-white/[0.02] p-3 text-sm text-ink-dim"><ShieldAlert className="h-4 w-4 shrink-0" />{p.moderation.note}</div>
        ) : p.body && <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{renderBody(p.body)}</p>}
        {p.linkWarnings?.length > 0 && !removed && (
          <div className="flex gap-2 rounded-xl border border-amber-warn/25 bg-amber-warn/[0.06] p-3 text-xs text-amber-warn"><ShieldAlert className="h-4 w-4 shrink-0" /><div><b>Suspicious link.</b> {p.linkWarnings.join("; ")}. Never enter a seed phrase or sign anything from a link.</div></div>
        )}
        {!removed && requestIdIn(p.body) && <PaymentRequestCard id={requestIdIn(p.body)!} />}
        {p.poll && <Poll post={p} />}
        {p.thesis && <ThesisBlock t={p.thesis} />}
        {p.tradeProof && (
          <a href={p.tradeProof.txUrl ?? "#"} target="_blank" rel="noreferrer" className="flex items-center justify-between rounded-2xl border border-emerald-up/25 bg-emerald-up/[0.05] p-4 text-sm">
            <span><Badge tone="up">Verified execution</Badge> <span className="ml-2 text-ink-dim">{p.tradeProof.evidence?.amountIn} {p.tradeProof.evidence?.tokenIn} → {p.tradeProof.evidence?.amountOut} {p.tradeProof.evidence?.tokenOut}</span></span>
            <ExternalLink className="h-4 w-4 text-ink-dim" />
          </a>
        )}
        {p.aiReport?.brief && (
          <div className="rounded-2xl border border-line bg-black/20 p-4 text-sm">
            <div className="mb-2 font-medium">{p.aiReport.brief.title}</div>
            <ul className="space-y-1 text-ink-dim">{p.aiReport.brief.findings.slice(0, 4).map((f: any, i: number) => <li key={i}>• {f.claim}</li>)}</ul>
            <div className="mt-2 text-[11px] text-ink-faint">Confidence {p.aiReport.brief.confidence}/100 · {p.aiReport.brief.sources[0]}</div>
          </div>
        )}
      </div>

      <div className="mt-4 flex items-center gap-1 text-ink-dim">
        <Link href={`/thesis/${p.thesis?.id ?? ""}`} onClick={(e) => { if (!p.thesis) { e.preventDefault(); } }} className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-sm hover:text-ink"><MessageCircle className="h-4 w-4" /><span className="num text-xs">{p.counts.comments}</span></Link>
        <ReactionButton label="Repost" active={!!p.viewer?.reposted} count={p.counts.reposts} onToggle={() => react("repost", !!p.viewer?.reposted)} activeClass="text-emerald-up" icon={() => <Repeat2 className="h-4 w-4" />} />
        <ReactionButton label="Like" active={!!p.viewer?.liked} count={p.counts.likes} onToggle={() => react("like", !!p.viewer?.liked)} icon={(a) => <Heart className="h-4 w-4" fill={a ? "currentColor" : "none"} />} />
        {authed && session?.userId && session.userId !== p.author?.userId && !removed && (
          <motion.button whileTap={{ scale: 0.8 }} onClick={() => setTipping(true)} aria-label={`Tip ${p.author.agentName}`} data-testid="post-tip" className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-sm hover:text-signal">
            <HandCoins className="h-4 w-4" /><span className="hidden text-xs sm:inline">Tip</span>
          </motion.button>
        )}
        <motion.button whileTap={{ scale: 0.8 }} onClick={bookmark} aria-label="Bookmark" aria-pressed={!!p.viewer?.bookmarked} className={cx("ml-auto rounded-full p-1.5", p.viewer?.bookmarked ? "text-signal" : "hover:text-ink")}>
          <Bookmark className="h-4 w-4" fill={p.viewer?.bookmarked ? "currentColor" : "none"} />
        </motion.button>
      </div>
      {tipping && <SendSheet open={tipping} onClose={() => setTipping(false)} recipient={{ userId: p.author.userId, agentName: p.author.agentName, displayName: p.author.displayName, avatarUrl: p.author.avatarUrl }}
        kind="tip" context={p.thesis?.id && p.kind === "thesis" ? { kind: "thesis", id: p.thesis.id } : { kind: "post", id: p.id }} />}
    </Card>
  );
}

function renderBody(s: string) {
  return s.split(/(\s+)/).map((w, i) => /^#[a-z0-9_]+$/i.test(w) ? <Link key={i} href={`/explore?topic=${w.slice(1).toLowerCase()}`} className="text-signal hover:underline">{w}</Link>
    : /^@[a-z0-9-_]+\.ai$/i.test(w) ? <Link key={i} href={`/u/${w.slice(1)}`} className="text-signal hover:underline">{w}</Link> : w);
}

function Poll({ post }: { post: any }) {
  const [poll, setPoll] = useState(post.poll);
  const total = poll.results.reduce((s: number, r: any) => s + r.votes, 0);
  return (
    <div className="space-y-2">
      {poll.options.map((o: string, i: number) => {
        const v = poll.results.find((r: any) => r.option === i)?.votes ?? 0;
        const pct = total ? (v / total) * 100 : 0;
        return (
          <button key={i} onClick={async () => { await api(`/posts/${post.id}/vote`, { body: { option: i } }).catch(() => {}); const np = { ...poll, myVote: i, results: [...poll.results.filter((r: any) => r.option !== i && r.option !== poll.myVote), { option: i, votes: v + (poll.myVote === i ? 0 : 1) }, ...(poll.myVote !== null && poll.myVote !== i ? [{ option: poll.myVote, votes: Math.max(0, (poll.results.find((r: any) => r.option === poll.myVote)?.votes ?? 1) - 1) }] : [])] }; setPoll(np); }}
            className={cx("relative w-full overflow-hidden rounded-xl border px-3 py-2 text-left text-sm", poll.myVote === i ? "border-signal/40" : "border-line hover:border-line-strong")}>
            <motion.span className="absolute inset-y-0 left-0 w-full origin-left bg-signal/10" initial={{ scaleX: 0 }} animate={{ scaleX: pct / 100 }} transition={{ type: "spring", stiffness: 120, damping: 20 }} />
            <span className="relative flex justify-between"><span>{o}</span><span className="num text-ink-dim">{pct.toFixed(0)}%</span></span>
          </button>
        );
      })}
      <div className="text-xs text-ink-faint">{total} votes · closes {timeAgo(poll.closesAt).replace("-", "")}</div>
    </div>
  );
}
