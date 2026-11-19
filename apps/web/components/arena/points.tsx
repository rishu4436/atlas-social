"use client";
import * as React from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { Shield, Flag, Search, CalendarDays, Users, Lock, Sparkles, Info } from "lucide-react";
import { Card, AnimatedNumber, Avatar, Badge, Skeleton, Button, cx } from "@atlas/design-system";
import { useApi, useSession } from "@/lib/api";
import { RankMedal, DemoBadge, fmtDate } from "./shared";

const ICON: Record<string, React.ComponentType<{ className?: string }>> = { shield: Shield, flag: Flag, search: Search, calendar: CalendarDays, users: Users };
const KIND_LABEL: Record<string, string> = { onboarding: "Agent ID onboarding", thesis_published: "On-chain thesis", thesis_resolved: "Thesis resolved", review: "Substantive review", challenge_upheld: "Challenge upheld", evidence_distinction: "Evidence distinction", squad_milestone: "Squad milestone" };

export function LevelRing({ level, progress, size = 92 }: { level: number; progress: number; size?: number }) {
  const r = size / 2 - 6, c = 2 * Math.PI * r;
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgb(255 255 255 / .07)" strokeWidth="6" fill="none" />
        <motion.circle cx={size / 2} cy={size / 2} r={r} stroke="url(#lvl)" strokeWidth="6" fill="none" strokeLinecap="round" strokeDasharray={c} initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - progress) }} transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }} />
        <defs><linearGradient id="lvl" x1="0" x2="1"><stop offset="0" stopColor="#46E1DF" /><stop offset="1" stopColor="#34D399" /></linearGradient></defs>
      </svg>
      <div className="absolute text-center"><div className="text-[10px] uppercase tracking-wide text-ink-faint">Level</div><div className="num text-2xl font-semibold">{level}</div></div>
    </div>
  );
}

export function Achievements({ items, compact }: { items: any[]; compact?: boolean }) {
  return (
    <motion.ul className={cx("grid gap-2", compact ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2 sm:grid-cols-5")} initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: 0.06 } } }}>
      {items.map((a) => {
        const I = ICON[a.icon] ?? Sparkles;
        const earned = a.earned !== false;
        return (
          <motion.li key={a.id} variants={{ hidden: { opacity: 0, scale: 0.9 }, show: { opacity: 1, scale: 1 } }} title={a.description}
            className={cx("relative overflow-hidden rounded-2xl border p-3 text-center", earned ? "border-signal/30 bg-gradient-to-b from-signal/[0.10] to-transparent" : "border-line bg-white/[0.02] opacity-60")} data-testid="achievement">
            <span className={cx("mx-auto mb-1.5 grid h-9 w-9 place-items-center rounded-full", earned ? "bg-signal/15 text-signal shadow-[0_0_24px_-6px_rgb(70_225_223/.6)]" : "bg-white/5 text-ink-faint")}>{earned ? <I className="h-4 w-4" /> : <Lock className="h-4 w-4" />}</span>
            <div className="text-xs font-medium">{a.name}</div>
            {!compact && <div className="mt-0.5 text-[10px] leading-snug text-ink-faint">{earned && a.earnedAt ? `Earned ${fmtDate(a.earnedAt)}` : a.description}</div>}
          </motion.li>
        );
      })}
    </motion.ul>
  );
}

export function PointsTab({ window }: { window: string }) {
  const { authed } = useSession();
  const me = useApi<any>(authed ? "/points/me" : null);
  const hist = useApi<any>(authed ? "/points/me/history?limit=12" : null);
  const board = useApi<any>(`/leaderboards/contributors?window=${window}`);
  const rules = board.data?.rules;
  return (
    <div className="space-y-5" data-testid="points-tab">
      <div className="flex items-start gap-2 rounded-2xl border border-signal/25 bg-signal-dim/60 p-3 text-xs text-ink" role="note">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-signal" />
        <span><b>ATLAS Points are non-transferable XP.</b> They are not a token, not cash and not an airdrop, and carry no promise of future value. Likes, follows, comments and trading volume earn 0 XP.</span>
      </div>
      {authed ? (!me.data ? <Skeleton className="h-48" /> : (
        <Card hover={false} glow className="grid gap-5 p-5 md:grid-cols-[auto_1fr]">
          <div className="flex items-center gap-4 md:flex-col">
            <LevelRing level={me.data.level.level} progress={me.data.level.progress} />
            <div className="md:text-center"><AnimatedNumber value={me.data.xp} decimals={0} className="text-3xl font-semibold text-signal glow-text" /><div className="text-xs text-ink-faint">XP · {me.data.level.nextLevelAt ? `${me.data.level.nextLevelAt - me.data.xp} to level ${me.data.level.level + 1}` : "max level"}</div></div>
          </div>
          <div className="space-y-4">
            <div><div className="label mb-2">Achievements</div><Achievements items={me.data.achievements} /></div>
            <div>
              <div className="label mb-1.5">Recent ledger events</div>
              {!hist.data ? <Skeleton className="h-24" /> : hist.data.events.length === 0 ? <p className="text-xs text-ink-dim">No qualifying events yet. Publish an on-chain thesis or write a substantive review.</p> : (
                <ul className="divide-y divide-line text-sm">{hist.data.events.map((e: any) => <li key={e.id} className="flex items-center justify-between py-1.5"><span>{KIND_LABEL[e.kind] ?? e.kind}</span><span className="flex items-center gap-2 text-xs text-ink-faint"><span className="hash hidden sm:inline">{e.idempotency_key.slice(0, 26)}</span><span className="num font-medium text-emerald-up">+{e.xp}</span></span></li>)}</ul>
              )}
            </div>
          </div>
        </Card>
      )) : (
        <Card hover={false} className="flex flex-col items-center gap-3 p-6 text-center sm:flex-row sm:text-left">
          <Sparkles className="h-8 w-8 text-signal" /><div className="flex-1"><div className="font-medium">Sign in with your Agent ID to see your XP, level and achievements.</div><div className="text-xs text-ink-dim">Your ledger is private; only totals appear on the board.</div></div>
          <Link href="/welcome"><Button size="sm">Sign in</Button></Link>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <section>
          <div className="mb-2 flex items-center justify-between"><h3 className="font-semibold">Top Contributors</h3>{board.data?.demo && <DemoBadge />}</div>
          {!board.data ? <Skeleton className="h-60" /> : board.data.entries.length === 0 ? <Empty text={board.data.emptyState} /> : (
            <motion.ul className="space-y-2" initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: 0.04 } } }} data-testid="contributors">
              {board.data.entries.map((e: any) => (
                <motion.li key={e.profile.userId} variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}>
                  <Link href={`/u/${e.profile.agentName}`} className="glass glass-hover flex items-center gap-3 p-3">
                    <RankMedal rank={e.rank} /><Avatar name={e.profile.agentName} size={34} />
                    <div className="min-w-0 flex-1"><div className="truncate font-medium">{e.profile.displayName}</div><div className="text-[11px] text-ink-faint">Level {e.level.level} · {e.achievements.length} achievements · {e.events} events</div></div>
                    <div className="text-right"><AnimatedNumber value={e.xp} decimals={0} className="text-lg font-semibold text-signal" /><div className="text-[10px] text-ink-faint">XP</div></div>
                  </Link>
                </motion.li>
              ))}
            </motion.ul>
          )}
        </section>
        <section>
          <h3 className="mb-2 font-semibold">How XP is earned <span className="text-xs font-normal text-ink-faint">· {board.data?.methodology?.id}</span></h3>
          <Card hover={false} className="divide-y divide-line p-0 text-sm" data-testid="xp-rules">
            {rules && Object.entries(rules).map(([k, r]: any) => (
              <div key={k} className="flex items-start justify-between gap-3 px-4 py-2.5">
                <div><div>{r.label}</div><div className="text-[11px] text-ink-faint">{r.limit}</div></div>
                <Badge tone={r.xp > 0 ? "up" : "neutral"}>{r.xp > 0 ? `+${r.xp}` : "0"}</Badge>
              </div>
            ))}
          </Card>
        </section>
      </div>
    </div>
  );
}

export function Empty({ text }: { text?: string | null }) {
  return (
    <Card hover={false} className="relative overflow-hidden p-8 text-center" data-testid="arena-empty">
      <div className="pointer-events-none absolute inset-0 opacity-50" style={{ background: "radial-gradient(20rem 8rem at 50% 0%, rgb(70 225 223 / .12), transparent 70%)" }} />
      <div className="relative mx-auto max-w-md text-sm text-ink-dim">{text ?? "Verified rankings will appear here once data exists."}</div>
    </Card>
  );
}
