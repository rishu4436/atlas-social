"use client";
import { motion } from "motion/react";
import { MessagesSquare, ShieldCheck, ShieldAlert, ShieldQuestion, Flag, FileText, User, Bot } from "lucide-react";
import { useState } from "react";
import { Card, Badge, Button, Skeleton, cx } from "@atlas/design-system";
import { api, useApi, timeAgo } from "@/lib/api";
import { useToast } from "@/components/providers";
import { AgentBadge } from "./badge";

const icon: Record<string, any> = { thesis: FileText, review: MessagesSquare, challenge: Flag, verification: ShieldCheck };
const verdictTone: Record<string, any> = { consistent: "up", inconsistent: "down", inconclusive: "warn" };
const verdictIcon: Record<string, any> = { consistent: ShieldCheck, inconsistent: ShieldAlert, inconclusive: ShieldQuestion };

/** Research thread: humans and AI agents publish, challenge and verify, each contribution attributed. */
export function ResearchThread({ thesisId, canVerify = false }: { thesisId: string; canVerify?: boolean }) {
  const t = useApi<any>(`/theses/${thesisId}/thread`);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const verify = async () => {
    setBusy(true);
    try { const r = await api(`/theses/${thesisId}/verifications`, { body: { note: "" } }); toast({ kind: r.verdict === "consistent" ? "ok" : "err", text: `Evidence ${r.verdict}` }); t.mutate(); }
    catch (e: any) { toast({ kind: "err", text: e.message }); } finally { setBusy(false); }
  };
  if (!t.data) return <Skeleton className="h-40" />;
  const { entries, participants } = t.data;
  return (
    <Card hover={false} className="p-5" data-testid="research-thread">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="label">Research thread</div>
        <div className="flex gap-1.5 text-xs">
          <Badge><User className="h-3 w-3" />{participants.humans} human</Badge>
          <Badge tone="ai"><Bot className="h-3 w-3" />{participants.agents} agent</Badge>
        </div>
      </div>
      <ol className="relative mt-4 space-y-4 border-l border-line pl-5">
        {entries.map((e: any, i: number) => {
          const I = e.kind === "verification" ? verdictIcon[e.verdict] ?? ShieldCheck : icon[e.kind] ?? FileText;
          return (
            <motion.li key={`${e.kind}-${e.id}`} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }} className="relative" data-testid={`thread-${e.kind}`}>
              <span className={cx("absolute -left-[29px] top-0.5 grid h-4 w-4 place-items-center rounded-full ring-4 ring-bg", e.authorType === "agent" ? "bg-violet-500/80" : "bg-signal/80")}><I className="h-2.5 w-2.5 text-bg" /></span>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium capitalize">{e.kind === "thesis" ? "published thesis" : e.kind}</span>
                <span className="text-ink-faint">by {e.author?.agentName ?? "unknown"}</span>
                {e.authorType === "agent" && <AgentBadge agent={e.agent} />}
                {e.kind === "review" && <Badge tone={e.stance === "ENDORSE" ? "up" : e.stance === "DISPUTE" ? "down" : "neutral"}>{e.stance.toLowerCase()}</Badge>}
                {e.kind === "verification" && <Badge tone={verdictTone[e.verdict]}>{e.verdict}</Badge>}
                {e.kind === "challenge" && <Badge tone="warn">{e.challengeKind} · {e.status}</Badge>}
                <span className="text-xs text-ink-faint">{timeAgo(e.createdAt)}</span>
              </div>
              {e.body && <p className="mt-1 whitespace-pre-wrap text-sm text-ink-dim">{e.body}</p>}
              {e.reason && <p className="mt-1 text-sm text-ink-dim">{e.reason}</p>}
              {e.kind === "verification" && (
                <div className="mt-1 space-y-0.5 text-xs text-ink-faint">
                  {(e.checks ?? []).map((c: any) => <div key={c.name}><span className={c.ok === true ? "text-emerald-up" : c.ok === false ? "text-coral-down" : "text-amber-300"}>{c.ok === true ? "✓" : c.ok === false ? "✗" : "?"}</span> {c.name}</div>)}
                  {e.note && <div className="text-ink-dim">“{e.note}”</div>}
                  <div className="hash">checks {String(e.checksHash).slice(0, 14)}… (recomputed by ATLAS)</div>
                </div>
              )}
            </motion.li>
          );
        })}
      </ol>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-md text-xs text-ink-faint">{t.data.note}</p>
        {canVerify && <Button size="sm" variant="outline" loading={busy} onClick={verify} data-testid="thread-verify"><ShieldCheck className="h-4 w-4" />Verify evidence</Button>}
      </div>
    </Card>
  );
}
