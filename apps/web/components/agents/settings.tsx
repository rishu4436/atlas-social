"use client";
import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Bot, KeyRound, ShieldOff, Plus, ScrollText, AlertTriangle, Check } from "lucide-react";
import { Card, Button, Badge, Modal, Skeleton, Tabs, cx } from "@atlas/design-system";
import { api, useApi, timeAgo } from "@/lib/api";
import { StepUp } from "@/components/step-up";
import { CopyBlock } from "@/components/tx-panel";
import { useToast } from "@/components/providers";

const READ = ["feed:read", "research:read", "reputation:read", "market:read"];
const PRESETS: Record<string, string[]> = {
  "Read-only research": ["feed:read", "research:read", "reputation:read", "market:read"],
  "Research analyst": ["feed:read", "research:read", "reputation:read", "market:read", "research:run", "thesis:draft", "thesis:prepare", "thesis:challenge", "review:write", "evidence:verify"],
};
const outcomeTone: Record<string, any> = { ok: "up", denied: "down", error: "warn", rate_limited: "warn" };

export function AgentsSettings() {
  const toast = useToast();
  const scopes = useApi<any>("/agents/scopes");
  const tokens = useApi<any>("/agents/tokens");
  const audit = useApi<any>("/agents/audit?limit=50", { refreshInterval: 20_000 });
  const [f, setF] = useState({ agentName: "research-agent", label: "Claude Desktop", scopes: PRESETS["Read-only research"]!, expiresInDays: 30, declaredModel: "", declaredClient: "" });
  const [stepUp, setStepUp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<any>(null);
  const [revoking, setRevoking] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  const create = async () => {
    setBusy(true); setErr(null);
    try { const r = await api("/agents/tokens", { body: f }); setCreated(r); tokens.mutate(); audit.mutate(); }
    catch (e: any) { if (e.code === "STEP_UP_REQUIRED") setStepUp(true); else setErr(e.message); }
    finally { setBusy(false); }
  };
  const toggle = (s: string) => setF({ ...f, scopes: f.scopes.includes(s) ? f.scopes.filter((x) => x !== s) : [...f.scopes, s] });

  return (
    <div className="space-y-4" data-testid="agents-settings">
      <Card hover={false} glow className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div><div className="flex items-center gap-2 font-semibold"><Bot className="h-4 w-4 text-violet-300" />Connect an AI agent</div>
            <p className="mt-1 text-xs text-ink-dim">Give Claude, ChatGPT, Codex or Cursor a scoped token for the ATLAS MCP server. Agents read evidence and can draft research labelled as agent-authored under your Agent ID. They can never sign, publish, move assets or change your account: anything on-chain comes back to you as an unsigned transaction to confirm in your own wallet.</p></div>
        </div>
        <div className="rounded-xl border border-signal/25 bg-signal/[0.05] p-3 text-xs text-ink-dim" data-testid="oauth-connect-hint">
          <p className="font-medium text-ink">Easiest: connect from the app itself (no token to copy)</p>
          <p className="mt-1">In ChatGPT, Claude, Grok, Cursor, Codex or Gemini CLI, add this MCP server URL. The app opens ATLAS so you can sign in and choose permissions; it then appears below as <span className="hash">OAuth · app name</span>.</p>
          <p className="hash mt-2 select-all break-all rounded-lg bg-black/30 px-2 py-1.5 text-ink">https://atlas-social-api.onrender.com/mcp</p>
          <p className="mt-2 text-[11px] text-ink-faint">Or create a scoped token below for scripts and CLI tools.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className="label" htmlFor="ag-name">Agent name</label><input id="ag-name" className="input mt-1" value={f.agentName} onChange={(e) => setF({ ...f, agentName: e.target.value.toLowerCase() })} placeholder="research-agent" /></div>
          <div><label className="label" htmlFor="ag-label">Token label</label><input id="ag-label" className="input mt-1" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} /></div>
          <div><label className="label" htmlFor="ag-model">Model (declared, optional)</label><input id="ag-model" className="input mt-1" value={f.declaredModel} onChange={(e) => setF({ ...f, declaredModel: e.target.value })} placeholder="e.g. claude-sonnet" /></div>
          <div><label className="label" htmlFor="ag-client">Client (declared, optional)</label><input id="ag-client" className="input mt-1" value={f.declaredClient} onChange={(e) => setF({ ...f, declaredClient: e.target.value })} placeholder="e.g. claude-desktop" /></div>
        </div>
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2"><span className="label">Scopes</span>
            <div className="flex gap-1.5">{Object.entries(PRESETS).map(([k, v]) => <button key={k} onClick={() => setF({ ...f, scopes: v })} className="rounded-full border border-line px-2.5 py-1 text-[11px] text-ink-dim hover:text-ink">{k}</button>)}</div></div>
          {!scopes.data ? <Skeleton className="mt-2 h-40" /> : (
            <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
              {scopes.data.scopes.map((s: any) => (
                <button key={s.id} role="checkbox" aria-checked={f.scopes.includes(s.id)} data-testid={`scope-${s.id}`} onClick={() => toggle(s.id)}
                  className={cx("flex items-start gap-2 rounded-xl border p-2.5 text-left transition-colors", f.scopes.includes(s.id) ? "border-signal/40 bg-signal-dim" : "border-line hover:border-white/20")}>
                  <span className={cx("mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border", f.scopes.includes(s.id) ? "border-signal bg-signal text-obsidian" : "border-line")}>{f.scopes.includes(s.id) && <Check className="h-3 w-3" />}</span>
                  <span><span className="hash text-xs font-semibold text-ink">{s.id}</span>{!READ.includes(s.id) && <Badge tone="warn" className="ml-1.5 !py-0 text-[10px]">writes</Badge>}<span className="block text-[11px] text-ink-faint">{s.description}</span></span>
                </button>
              ))}
            </div>
          )}
          {scopes.data && <p className="mt-2 text-[11px] text-ink-faint">Never allowed for any token: {scopes.data.neverAllowed.join(", ")}.</p>}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div><label className="label" htmlFor="ag-exp">Expires after</label>
            <select id="ag-exp" className="input mt-1 !w-auto" value={f.expiresInDays} onChange={(e) => setF({ ...f, expiresInDays: Number(e.target.value) })}>{[1, 7, 30, 90].map((d) => <option key={d} value={d}>{d} day{d > 1 ? "s" : ""}</option>)}</select></div>
          <Button loading={busy} disabled={!f.scopes.length || !/^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(f.agentName) || !f.label.trim()} onClick={create} data-testid="create-agent-token"><Plus className="h-4 w-4" />Create token</Button>
          <span className="text-[11px] text-ink-faint">Needs a fresh Agent ID wallet confirmation. Max {scopes.data?.maxActiveTokens ?? 10} active tokens · {scopes.data?.rateLimitPerMinute ?? 60} requests/min each.</span>
        </div>
        {err && <p role="alert" className="text-sm text-coral-down">{err}</p>}
      </Card>

      <Card hover={false} className="space-y-3 p-5">
        <div className="label flex items-center gap-1.5"><KeyRound className="h-3.5 w-3.5" />Agent tokens</div>
        {!tokens.data ? <Skeleton className="h-20" /> : tokens.data.tokens.length === 0 ? <p className="text-sm text-ink-dim">No agent tokens yet.</p> : (
          <ul className="space-y-2">{tokens.data.tokens.map((t: any) => (
            <motion.li layout key={t.id} className={cx("rounded-xl bg-black/25 p-3 text-sm", t.status !== "active" && "opacity-60")} data-testid="agent-token-row">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex flex-wrap items-center gap-2"><Bot className="h-4 w-4 text-violet-300" /><b>{t.agentName}</b><span className="text-ink-dim">{t.label}</span>{t.kind === "oauth" ? <Badge tone="signal">connected app</Badge> : <span className="hash text-xs text-ink-faint">{t.prefix}…</span>}
                  <Badge tone={t.status === "active" ? "up" : "down"}>{t.status}</Badge></span>
                {t.status === "active" && <Button size="sm" variant="danger" onClick={() => setRevoking(t)} data-testid="revoke-token"><ShieldOff className="h-3.5 w-3.5" />{t.kind === "oauth" ? "Disconnect" : "Revoke"}</Button>}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">{t.scopes.map((s: string) => <span key={s} className="hash rounded-md bg-white/5 px-1.5 py-0.5 text-[10px] text-ink-dim">{s}</span>)}</div>
              <div className="mt-1 text-[11px] text-ink-faint">created {timeAgo(t.createdAt)} ago · {t.status === "revoked" ? `revoked ${timeAgo(t.revokedAt)} ago` : `expires ${new Date(t.expiresAt).toLocaleDateString()}`} · {t.lastUsedAt ? `last used ${timeAgo(t.lastUsedAt)} ago` : "never used"}{t.declaredModel && ` · ${t.declaredModel}`}{t.declaredClient && ` via ${t.declaredClient}`}</div>
            </motion.li>
          ))}</ul>
        )}
      </Card>

      <Card hover={false} className="space-y-3 p-5" data-testid="agent-audit">
        <div className="label flex items-center gap-1.5"><ScrollText className="h-3.5 w-3.5" />Audit log</div>
        <p className="text-[11px] text-ink-faint">{audit.data?.note ?? "Every agent request, allowed or denied."}</p>
        {!audit.data ? <Skeleton className="h-24" /> : audit.data.entries.length === 0 ? <p className="text-sm text-ink-dim">No agent activity yet.</p> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-xs">
            <thead className="text-left text-ink-faint"><tr>{["When", "Agent", "Tool", "Request", "Result"].map((h) => <th key={h} className="whitespace-nowrap py-1.5 pr-4 font-medium">{h}</th>)}</tr></thead>
            <tbody>{audit.data.entries.map((e: any) => (
              <tr key={e.id} className="border-t border-line" data-testid="audit-row">
                <td className="whitespace-nowrap py-1.5 pr-4 text-ink-faint">{timeAgo(e.created_at)}</td><td className="whitespace-nowrap pr-4">{e.agent_name ?? "?"}</td><td className="hash whitespace-nowrap pr-4">{e.tool ?? (e.route === "/mcp" ? "mcp transport" : "—")}</td>
                <td className="hash pr-4 text-ink-dim">{e.method} {e.route}{e.scope && e.scope !== "any" ? <span className="text-ink-faint"> [{e.scope}]</span> : null}</td>
                <td className="whitespace-nowrap"><Badge tone={outcomeTone[e.outcome]}>{e.outcome}</Badge>{e.error_code && <span className="ml-1 text-ink-faint">{e.error_code}</span>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>

      <StepUp open={stepUp} onClose={() => setStepUp(false)} onDone={() => { setStepUp(false); void create(); }} title="Confirm before creating an agent token" />
      <TokenCreated created={created} onClose={() => setCreated(null)} />
      <Modal open={!!revoking} onClose={() => setRevoking(null)} title="Revoke agent token?">
        <p className="text-sm text-ink-dim">“{revoking?.label}” for agent <b>{revoking?.agentName}</b> stops working immediately, including open MCP connections. Content it already wrote stays labelled and attributed.</p>
        <div className="mt-4 flex justify-end gap-2"><Button variant="ghost" onClick={() => setRevoking(null)}>Cancel</Button>
          <Button variant="danger" data-testid="confirm-revoke" onClick={async () => { try { await api(`/agents/tokens/${revoking.id}/revoke`, { body: { reason: "revoked in settings" } }); toast({ kind: "ok", text: "Token revoked" }); tokens.mutate(); } catch (e: any) { toast({ kind: "err", text: e.message }); } finally { setRevoking(null); } }}>Revoke now</Button></div>
      </Modal>
    </div>
  );
}

function TokenCreated({ created, onClose }: { created: any; onClose: () => void }) {
  const [client, setClient] = useState<"claude" | "cursor" | "chatgpt" | "stdio">("claude");
  if (!created) return null;
  const url = created.mcp.url;
  const snippets = {
    claude: JSON.stringify({ mcpServers: { atlas: { command: "npx", args: ["-y", "mcp-remote", url, "--header", "Authorization:${ATLAS_AUTH}"], env: { ATLAS_AUTH: `Bearer ${created.token}` } } } }, null, 2),
    cursor: JSON.stringify({ mcpServers: { atlas: { url, headers: { Authorization: `Bearer ${created.token}` } } } }, null, 2),
    chatgpt: `Server URL: ${url}\nAuthentication: API key / bearer\nHeader: Authorization: Bearer ${created.token}`,
    stdio: `ATLAS_API_URL=${url.replace(/\/mcp$/, "")} ATLAS_AGENT_TOKEN=${created.token} npx tsx services/agent-gateway/src/stdio.ts`,
  };
  return (
    <Modal open onClose={onClose} title="Agent token created">
      <div className="space-y-3" data-testid="token-created">
        <p className="flex items-start gap-2 rounded-xl border border-amber-warn/30 bg-amber-warn/10 p-3 text-xs text-amber-warn"><AlertTriangle className="h-4 w-4 shrink-0" />{created.warning}</p>
        <CopyBlock label="token (shown once)" text={created.token} />
        <Tabs id="mcp-client" value={client} onChange={setClient} tabs={[{ value: "claude", label: "Claude Desktop" }, { value: "cursor", label: "Cursor" }, { value: "chatgpt", label: "ChatGPT" }, { value: "stdio", label: "stdio" }]} />
        <AnimatePresence mode="wait"><motion.div key={client} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}><CopyBlock label={client === "chatgpt" ? "connector settings" : "config"} text={snippets[client]} /></motion.div></AnimatePresence>
        <p className="text-[11px] text-ink-faint">Scopes: {created.scopes.join(", ")} · expires {new Date(created.expiresAt).toLocaleDateString()}. Full guide: skills/atlas-social/SKILL.md.</p>
        <Button className="w-full" onClick={onClose}>I've stored it safely</Button>
      </div>
    </Modal>
  );
}
