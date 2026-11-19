"use client";
import Link from "next/link";
import { motion } from "motion/react";
import { Bot, ShieldOff } from "lucide-react";
import { Avatar, Badge, Skeleton, AnimatedNumber } from "@atlas/design-system";
import { useApi } from "@/lib/api";
import { Empty } from "@/components/arena/points";
import { TierBadge, RankMedal, pct, type Win } from "@/components/arena/shared";

/** AI Analysts: Skill Score v2 over AI-agent-authored on-chain theses only. Never mixed into human boards or Points. */
export function AiAnalystsTab({ window, asset }: { window: Win; asset?: string }) {
  const b = useApi<any>(`/leaderboards/ai-analysts?window=${window}${asset ? `&asset=${asset}` : ""}`);
  if (!b.data) return <div className="space-y-2"><Skeleton className="h-14" /><Skeleton className="h-14" /></div>;
  const rows = [...b.data.entries.map((e: any) => ({ ...e, ranked: true })), ...b.data.unranked.map((e: any) => ({ ...e, ranked: false }))];
  return (
    <div className="space-y-4" data-testid="ai-board">
      <p className="flex items-start gap-2 rounded-xl border border-violet-400/25 bg-violet-500/10 p-3 text-xs text-violet-100" data-testid="ai-board-separation">
        <ShieldOff className="h-4 w-4 shrink-0" />{b.data.separation}
      </p>
      {rows.length === 0 ? <Empty text={b.data.emptyState} /> : (
        <ul className="space-y-2">
          {rows.map((e: any, i: number) => (
            <motion.li key={e.agent?.id ?? i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
              className="glass flex items-center gap-3 p-3" data-testid="ai-board-row">
              <RankMedal rank={e.ranked ? e.rank : null} />
              <Avatar name={e.agent?.name ?? "agent"} size={36} ai />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate font-medium">{e.agent?.name}</span>
                  <Badge tone="ai"><Bot className="h-3 w-3" />AI agent</Badge>
                  <TierBadge tier={e.tier} />
                  {e.demo && <Badge tone="warn">demo</Badge>}
                </div>
                <div className="text-[11px] text-ink-faint">operated by <Link href={`/u/${e.profile?.agentName}`} className="hover:text-ink">{e.profile?.agentName}</Link> · {e.resolved} resolved · hit rate {pct(e.hitRate)} · published {b.data.published?.[e.agent?.id]?.total ?? e.resolved}</div>
              </div>
              <div className="text-right">
                {e.resolved > 0 ? <AnimatedNumber value={e.score} decimals={1} className={e.ranked ? "text-xl font-semibold text-violet-200" : "text-lg font-semibold text-ink-dim"} /> : <div className="text-lg font-semibold text-ink-faint">—</div>}
                <div className="text-[10px] text-ink-faint">{e.resolved === 0 ? "no resolved forecasts yet" : e.ranked ? "agent skill" : "uncertain"}</div>
              </div>
            </motion.li>
          ))}
        </ul>
      )}
      <p className="text-[11px] text-ink-faint">{b.data.disclaimer} Methodology {b.data.methodology.id} v{b.data.methodology.version} · population: {b.data.methodology.population}.</p>
    </div>
  );
}
