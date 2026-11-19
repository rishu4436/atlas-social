"use client";
import Link from "next/link";
import { Card, Skeleton, AnimatedNumber, Badge } from "@atlas/design-system";
import { useApi } from "@/lib/api";
import { LevelRing, Achievements } from "./points";
import { RankJourney } from "./rank-journey";
import { TierBadge, Meter, DemoBadge } from "./shared";

/** Compact achievement chips for the profile header. */
export function AchievementChips({ userId }: { userId: string }) {
  const a = useApi<any>(`/users/${userId}/arena`);
  if (!a.data?.achievements?.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="profile-achievements">
      <Badge tone="signal">Level {a.data.level.level} · {a.data.xp} XP</Badge>
      {a.data.achievements.map((x: any) => <Badge key={x.id} tone="up">{x.name}</Badge>)}
    </div>
  );
}

export function ProfileArena({ userId }: { userId: string }) {
  const a = useApi<any>(`/users/${userId}/arena`);
  const s = useApi<any>(`/users/${userId}/score-breakdown?window=all`);
  return (
    <div className="space-y-4" data-testid="profile-arena">
      <Card hover={false} className="grid gap-4 p-5 sm:grid-cols-[auto_1fr]">
        {!a.data ? <Skeleton className="h-24 w-full sm:col-span-2" /> : (
          <>
            <div className="flex items-center gap-4 sm:flex-col">
              <LevelRing level={a.data.level.level} progress={a.data.level.progress} size={84} />
              <div className="sm:text-center"><AnimatedNumber value={a.data.xp} decimals={0} className="text-2xl font-semibold text-signal" /><div className="text-[11px] text-ink-faint">ATLAS Points (XP)</div></div>
            </div>
            <div className="space-y-2">
              <div className="label">Achievements</div>
              {a.data.achievements.length ? <Achievements items={a.data.achievements} compact /> : <p className="text-xs text-ink-dim">No achievements yet.</p>}
              <p className="text-[10px] text-ink-faint">{a.data.disclaimer}</p>
            </div>
          </>
        )}
      </Card>
      <Card hover={false} className="space-y-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="label">Skill Score v2 · all time</div>
          {s.data && <div className="flex items-center gap-1.5"><TierBadge tier={s.data.tier} />{s.data.ranks.analysts && <Badge tone="signal">#{s.data.ranks.analysts} Top Analysts</Badge>}{s.data.demo && <DemoBadge />}</div>}
        </div>
        {!s.data ? <Skeleton className="h-24" /> : (
          <>
            <div className="flex items-end gap-3"><AnimatedNumber value={s.data.score} decimals={1} className="text-3xl font-semibold" /><span className="pb-1 text-xs text-ink-faint">{s.data.tierReason}</span></div>
            <div className="grid gap-2 sm:grid-cols-5">{s.data.components.map((c: any, i: number) => <div key={c.key}><div className="truncate text-[10px] text-ink-faint">{c.label}</div><Meter value={c.normalized} delay={i * 0.05} className="mt-1" /></div>)}</div>
          </>
        )}
        <div className="label pt-2">Rank Journey</div>
        <RankJourney userId={userId} window="all" />
        <Link href="/arena" className="inline-block text-xs text-signal hover:underline">Open Arena →</Link>
      </Card>
    </div>
  );
}
