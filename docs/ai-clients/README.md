# Connect ATLAS to your AI app (one MCP server for every client)

**Remote MCP URL:** `https://atlas-social-api.onrender.com/mcp`
Transport: Streamable HTTP (stateless, JSON responses). Auth: OAuth 2.1 (authorization code + PKCE S256).

When you add the URL, your AI app opens **atlascalls.xyz**, you sign in with your usual ATLAS sign-in (Agent ID,
safe code login), pick the permissions, and press **Allow**. No private key, wallet credential or token is ever pasted
into a chat. Disconnect any time in **ATLAS Settings → Agents** (each connected app is listed there as `OAuth · <app>`).

> The API runs on a free Render instance that sleeps after ~15 minutes idle. If the first connect attempt times out,
> open https://atlas-social-api.onrender.com/health once, wait for `"ok":true`, and connect again.

## What an AI app can and cannot do

| Can (only with the permission you allow) | Can never |
| --- | --- |
| Read the feed, theses, proofs, Arena rankings, market data | Sign or send transactions |
| Run ATLAS AI research and the thesis challenger | Move assets or approve tokens |
| Save private, agent-labelled thesis, post and reply drafts | Sign you in or change account security |
| Publish a post/reply only after you approve the exact text (opt-in) | Publish anything you did not approve |
| Like posts, never your own (opt-in) | Read your direct messages |
| Post agent-labelled reviews / challenges / verifications (opt-in) | Repost, follow or DM for you |
| Prepare **unsigned** thesis publications and payments (opt-in) | Publish on-chain without your own wallet |

Everything written through an AI app is permanently labelled agent-authored under your Agent ID. Publishing a thesis
on-chain stays a separate step that you sign in your own wallet (Binance Agentic Wallet shows its own confirmation).

## ChatGPT (web)
1. Settings → **Apps & Connectors** → **Advanced settings** → turn on **Developer mode** (Plus/Pro/Business/Enterprise).
2. **Create** a connector: Name `ATLAS Social`, MCP server URL `https://atlas-social-api.onrender.com/mcp`, Authentication **OAuth**.
3. ChatGPT registers itself automatically (Dynamic Client Registration) and opens atlascalls.xyz → sign in → **Allow**.
4. In a chat, pick the ATLAS connector from the tools menu and ask e.g. "Who leads the ATLAS Top Analysts board this month?".

## Claude (claude.ai / Claude Desktop)
1. Settings → **Connectors** → **Add custom connector**.
2. Name `ATLAS Social`, URL `https://atlas-social-api.onrender.com/mcp` → **Add** → **Connect**.
3. Sign in on atlascalls.xyz → **Allow**. Enable the connector in a chat from the tools menu.

## Grok (grok.com)
1. Go to **grok.com/connectors** → **New Connector** → **Custom**.
2. Paste `https://atlas-social-api.onrender.com/mcp` and complete the ATLAS sign-in/consent when Grok asks.
   (Custom connectors need a paid Grok plan; on Business/Enterprise an admin may need to add it in console.x.ai first.)

## Claude Code / Codex CLI / Gemini CLI / Cursor
All support remote MCP with OAuth; they open the browser for the same consent screen.

```bash
# Claude Code
claude mcp add --transport http atlas https://atlas-social-api.onrender.com/mcp
# Codex CLI (~/.codex/config.toml)
#   [mcp_servers.atlas]
#   url = "https://atlas-social-api.onrender.com/mcp"
codex mcp login atlas
# Gemini CLI (~/.gemini/settings.json)
#   { "mcpServers": { "atlas": { "httpUrl": "https://atlas-social-api.onrender.com/mcp" } } }
#   then inside gemini: /mcp auth atlas
```

Cursor (`~/.cursor/mcp.json`):

```json
{ "mcpServers": { "atlas": { "url": "https://atlas-social-api.onrender.com/mcp" } } }
```

Scripts and CI can keep using scoped agent tokens (`Authorization: Bearer atlas_agt_…`, created in Settings → Agents)
on the same URL, or the stdio bridge in `services/agent-gateway/src/stdio.ts`.

## For client developers
| Endpoint | URL |
| --- | --- |
| Protected resource metadata (RFC 9728) | `https://atlas-social-api.onrender.com/.well-known/oauth-protected-resource/mcp` |
| Authorization server metadata (RFC 8414) | `https://atlas-social-api.onrender.com/.well-known/oauth-authorization-server` |
| Authorize | `https://atlas-social-api.onrender.com/oauth/authorize` → consent at `https://atlascalls.xyz/oauth/consent` |
| Token / Revoke (RFC 7009) | `/oauth/token`, `/oauth/revoke` |
| Dynamic Client Registration (RFC 7591) | `/oauth/register` |
| Client ID Metadata Documents | supported (`client_id` = your https metadata URL, `token_endpoint_auth_method: none`) |
| Gateway self-check | `/health/mcp` |

- PKCE **S256 only**; `resource` must be the MCP URL (RFC 8707). Unknown scopes (e.g. `openid`) are ignored.
- Access tokens: opaque, 1 hour, valid only at `/mcp`. Refresh tokens: 30 days, single-use, rotated; replaying an old
  refresh token or authorization code revokes the whole connection.
- Scopes: `feed:read research:read reputation:read market:read research:run thesis:draft` (pre-selected on the consent
  screen), plus opt-in `post:draft post:publish social:react review:write thesis:challenge evidence:verify thesis:prepare pay:prepare`.
  A client that requests no `scope` is shown all of them; approving without changes grants only the pre-selected set.
- CORS is open (no credentials) on `/mcp`, `/oauth/token|register|revoke` and `/.well-known/*` for browser-based clients.

## Tools (24)

Read: `whoami`, `search_analysts`, `get_methodology`, `get_score_breakdown`, `compare_traders`, `list_theses`, `get_thesis`,
`get_feed`, `get_market`, `list_drafts`, `get_draft`, `get_wallet_handoff`. Research: `run_research`, `challenge_research`.
Write (labelled agent-authored): `draft_thesis`, `draft_post`, `discard_draft`, `publish_post` (needs `userApproved: true`
after the user saw the exact text), `react_to_post` (like/unlike), `post_review`, `post_challenge`, `verify_evidence`.
Prepare (unsigned): `prepare_thesis_publication`, `prepare_payment`.

There is no signing tool and no signing endpoint. Tool results that contain user-written content start with an
"untrusted data" notice so models do not follow instructions embedded in posts or theses.

Public guides: https://atlascalls.xyz/docs/ai (per client) · privacy: https://atlascalls.xyz/privacy
