import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Ban, Check, KeyRound, ShieldCheck, Wallet } from "lucide-react";
import { DocsShell } from "@/components/docs/docs-shell";
import { CopyCode } from "@/components/docs/copy";
import { CLIENTS, CAN, NEVER, MCP_URL, API_URL, SUPPORT_AS_OF, STATUS_LABEL, type SupportStatus } from "@/lib/ai-clients";

export const metadata: Metadata = {
  title: "Connect ATLAS to your AI app · Claude and ChatGPT verified",
  description: "One remote MCP URL. Claude and ChatGPT are verified end to end. Gemini and Grok can connect but chat does not call tools yet. OAuth sign-in on atlascalls.xyz, scoped permissions, no wallet signing.",
};

const KIND: Record<string, string> = { web: "Web app", desktop: "Desktop", cli: "Terminal", ide: "Editor" };
const STATUS_TONE: Record<SupportStatus, string> = {
  verified: "border-emerald-up/40 text-emerald-up",
  "connects-no-tools": "border-amber-warn/40 text-amber-warn",
  "not-verified": "border-line text-ink-dim",
};

export default function AiDocs() {
  return (
    <DocsShell>
      <section className="pt-10 sm:pt-16">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-signal">Model Context Protocol</p>
        <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-tight text-ink sm:text-5xl">Bring ATLAS into the AI app you already use</h1>
        <p className="mt-4 max-w-2xl text-lg text-ink-dim">Paste one URL. Your AI app sends you to atlascalls.xyz to sign in and choose what it may do. No keys or wallet credentials ever go into a chat.</p>
        <div className="mt-6 max-w-2xl">
          <p className="text-sm text-ink-dim">Remote MCP server URL</p>
          <CopyCode code={MCP_URL} />
          <p className="mt-2 text-xs text-ink-faint">Streamable HTTP · OAuth 2.1 with PKCE · works from browser-based clients. If the first try times out, the server is waking up: open <a className="underline" href={`${API_URL}/health`}>/health</a>, wait for ok, and retry.</p>
        </div>
      </section>

      <section className="mt-14">
        <h2 className="text-xl font-semibold text-ink">Support matrix</h2>
        <p className="mt-2 max-w-2xl text-sm text-ink-dim">Live checks on {SUPPORT_AS_OF}. Only Claude and ChatGPT are integrated. Gemini and Grok can finish OAuth (Gemini also syncs all 24 tools) but chat does not call tools yet. CLI and editor apps have setup guides and are not claimed as integrated.</p>
        <div className="mt-4 overflow-x-auto rounded-2xl border border-line">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line text-xs uppercase tracking-wide text-ink-faint">
              <tr><th className="px-4 py-3 font-medium">Client</th><th className="px-4 py-3 font-medium">Status</th><th className="px-4 py-3 font-medium">Notes</th></tr>
            </thead>
            <tbody className="divide-y divide-line text-ink-dim">
              {CLIENTS.map((c) => (
                <tr key={c.slug}>
                  <td className="px-4 py-3"><Link href={`/docs/ai/${c.slug}`} className="font-medium text-ink hover:text-signal">{c.name}</Link><span className="mt-0.5 block text-[11px] text-ink-faint">{KIND[c.kind]}</span></td>
                  <td className="px-4 py-3"><span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] ${STATUS_TONE[c.status]}`}>{STATUS_LABEL[c.status]}</span></td>
                  <td className="px-4 py-3">{c.statusDetail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-14">
        <h2 className="text-xl font-semibold text-ink">Setup guides</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {CLIENTS.map((c) => (
            <Link key={c.slug} href={`/docs/ai/${c.slug}`} className="glass group flex flex-col gap-2 p-5 transition hover:-translate-y-0.5 hover:border-line-strong">
              <div className="flex items-center justify-between gap-2">
                <span className="text-base font-semibold text-ink">{c.name}</span>
                <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] ${STATUS_TONE[c.status]}`}>{STATUS_LABEL[c.status]}</span>
              </div>
              <p className="text-sm text-ink-dim">{c.tagline}</p>
              <span className="mt-auto inline-flex items-center gap-1 text-sm text-signal">Setup guide <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" /></span>
            </Link>
          ))}
        </div>
      </section>

      <section className="mt-14 grid gap-4 md:grid-cols-2">
        <div className="glass p-6">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-ink"><ShieldCheck className="h-5 w-5 text-signal" /> What it can do, if you allow it</h2>
          <ul className="mt-4 space-y-2.5 text-sm text-ink-dim">{CAN.map((x) => <li key={x} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-up" />{x}</li>)}</ul>
          <p className="mt-4 text-xs text-ink-faint">Reading and research are pre-selected. Writing, publishing and preparing transactions stay off until you switch them on.</p>
        </div>
        <div className="glass p-6">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-ink"><Ban className="h-5 w-5 text-amber-warn" /> What it can never do</h2>
          <ul className="mt-4 space-y-2.5 text-sm text-ink-dim">{NEVER.map((x) => <li key={x} className="flex gap-2"><Ban className="mt-0.5 h-4 w-4 shrink-0 text-amber-warn" />{x}</li>)}</ul>
          <p className="mt-4 text-xs text-ink-faint">Everything an AI app writes is permanently labelled agent-authored under your Agent ID, with the app and model it declared.</p>
        </div>
      </section>

      <section className="mt-14 glass p-6 sm:p-8">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-ink"><Wallet className="h-5 w-5 text-signal" /> Wallet steps stay with you</h2>
        <div className="mt-4 grid gap-6 text-sm text-ink-dim md:grid-cols-3">
          <div><p className="font-medium text-ink">1 · The AI prepares</p><p className="mt-1">Tools like prepare_thesis_publication return unsigned data: chain, contract, calldata (value 0) and a Binance Agentic Wallet preview command.</p></div>
          <div><p className="font-medium text-ink">2 · You review and sign</p><p className="mt-1">Open the thesis on atlascalls.xyz and press Publish on-chain, or run the baw preview on your own computer, check it, then confirm it yourself.</p></div>
          <div><p className="font-medium text-ink">3 · ATLAS checks the chain</p><p className="mt-1">A thesis counts as published only after ATLAS reads the real transaction receipt and its event. Nothing is taken on the AI&apos;s word.</p></div>
        </div>
        <div className="mt-6 rounded-xl border border-line bg-black/25 p-4 text-sm text-ink-dim">
          <p className="flex items-center gap-2 font-medium text-ink"><KeyRound className="h-4 w-4 text-signal" /> Signing in with Binance Agentic Wallet from a terminal</p>
          <p className="mt-1">On the sign-in page choose Continue with Agentic Wallet. The page shows a one-time code bound to that tab and a one-line command. Run it on your computer; it shows the exact login message (site, wallet, expiry) and asks y/N before anything is signed. Then confirm your Agent ID back in the same tab.</p>
          <CopyCode code="curl -fsSL https://atlascalls.xyz/connect.sh | sh -s ATC-XXXXXXXXXXXXXXXXXXXXXXXXXX" />
          <p className="mt-2 text-xs text-ink-faint">Windows PowerShell: iex &quot;&amp; {"{"} $(irm https://atlascalls.xyz/connect.ps1) {"}"} ATC-…&quot;. The real code comes from the sign-in page and works once, for about 10 minutes.</p>
        </div>
      </section>

      <section className="mt-14">
        <h2 className="text-lg font-semibold text-ink">For client developers</h2>
        <div className="mt-4 overflow-x-auto rounded-2xl border border-line">
          <table className="w-full text-left text-sm">
            <tbody className="divide-y divide-line text-ink-dim">
              {[
                ["Protected resource metadata (RFC 9728)", `${API_URL}/.well-known/oauth-protected-resource/mcp`],
                ["Authorization server metadata (RFC 8414)", `${API_URL}/.well-known/oauth-authorization-server`],
                ["Dynamic Client Registration (RFC 7591)", `${API_URL}/oauth/register`],
                ["Client ID Metadata Documents", "supported: client_id = your https metadata URL"],
                ["Token / revoke", `${API_URL}/oauth/token · /oauth/revoke`],
                ["Gateway health", `${API_URL}/health/mcp`],
              ].map(([k, v]) => <tr key={k}><td className="px-4 py-3 text-ink">{k}</td><td className="px-4 py-3 font-mono text-xs">{v}</td></tr>)}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-ink-faint">PKCE S256 only. resource must be the MCP URL. Access tokens last 1 hour and work only at /mcp; refresh tokens are single-use and rotate, and a replayed one revokes the connection. CORS is open without credentials on /mcp, /oauth/* and /.well-known/*.</p>
      </section>
    </DocsShell>
  );
}
