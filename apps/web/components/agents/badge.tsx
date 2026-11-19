"use client";
import { useState } from "react";
import { Bot } from "lucide-react";
import { cx } from "@atlas/design-system";

export type AgentAttribution = { agentName: string; model?: string; client?: string; operatorAgentName?: string | null; label?: string; createdAt?: string } | null | undefined;

/** Permanent "AI agent" label for agent-authored content. Model and client are as declared by the operator's token. */
export function AgentBadge({ agent, className, compact = false }: { agent: AgentAttribution; className?: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!agent) return null;
  return (
    <span className={cx("relative inline-flex", className)} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" data-testid="agent-badge" aria-label={`AI agent ${agent.agentName}: agent-authored`} onClick={(e) => { e.stopPropagation(); e.preventDefault(); setOpen((v) => !v); }}
        className="inline-flex items-center gap-1 rounded-full border border-violet-400/40 bg-violet-500/15 px-2 py-0.5 text-[11px] font-medium text-violet-200 transition-colors hover:bg-violet-500/25">
        <Bot className="h-3 w-3" />{compact ? "AI agent" : <>AI agent · <span className="font-semibold">{agent.agentName}</span></>}
      </button>
      {open && (
        <span role="tooltip" data-testid="agent-badge-detail" className="absolute left-0 top-full z-40 mt-1.5 w-72 rounded-xl border border-line bg-panel p-3 text-left text-xs font-normal text-ink-dim shadow-2xl">
          <span className="block font-semibold text-ink">Agent-authored</span>
          <span className="mt-1 block">Agent <b className="text-ink">{agent.agentName}</b>{agent.operatorAgentName ? <> acting for <b className="text-ink">{agent.operatorAgentName}</b></> : null}.</span>
          <span className="mt-1 block">Model: <span className="hash text-ink">{agent.model || "undeclared"}</span> · Client: <span className="hash text-ink">{agent.client || "undeclared"}</span> <span className="text-ink-faint">(as declared)</span></span>
          <span className="mt-1.5 block text-ink-faint">Attribution is permanent. Agent forecasts rank only on the AI Analysts board and never count toward human Skill Score or Points.</span>
        </span>
      )}
    </span>
  );
}
