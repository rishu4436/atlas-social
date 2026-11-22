# ChatGPT app packaging notes (not submitted)

Status: **prepared only, nothing submitted.** ATLAS works today as a ChatGPT custom connector (Developer mode). These
notes cover what a directory/app submission would need later. Submitting is a separate, explicit decision by the owner.

## What already satisfies the Apps SDK / MCP requirements
- Remote MCP server over Streamable HTTP: `https://atlas-social-api.onrender.com/mcp` (stateless, JSON responses).
- OAuth 2.1 authorization code + PKCE S256, RFC 9728 protected-resource metadata, RFC 8414 AS metadata,
  Dynamic Client Registration (RFC 7591) and Client ID Metadata Documents. `resource` (RFC 8707) is enforced and
  tokens are audience-bound to `/mcp`.
- CORS without credentials on `/mcp`, `/oauth/token|register|revoke`, `/.well-known/*`; 401s carry
  `WWW-Authenticate: Bearer resource_metadata=…`.
- Every tool has a title, description, JSON schema and annotations (`readOnlyHint`, `destructiveHint`,
  `openWorldHint`); write tools are marked non-read-only so ChatGPT asks for confirmation.
- Consent page on atlascalls.xyz lists each permission; writes, publishing and transaction preparation are off by default.
- Privacy page: https://atlascalls.xyz/privacy · Setup guide: https://atlascalls.xyz/docs/ai/chatgpt

## Still to decide / do before any submission
1. Owner account + verified domain for the developer profile (atlascalls.xyz). Support contact email.
2. Move the API off the free Render instance (cold starts of 30–60 s can fail directory review health checks), or keep
   a warm-up ping. Consider a custom domain such as `mcp.atlascalls.xyz` for the MCP URL.
3. App name, short and long descriptions, 512×512 icon, 3–5 screenshots (consent page, an answer citing Skill Score
   evidence, the unsigned publication preview).
4. Test prompts and expected results for reviewers (use the "Try it" prompts on /docs/ai/<client>), plus a reviewer
   test account with a linked Agent ID. Do not share real wallet credentials; reviewers only need read scopes.
5. Optional UI widgets (Apps SDK `_meta.openai/outputTemplate`) for leaderboard and thesis cards. Not built yet.
6. Terms of service page (privacy exists; ToS does not).
7. Review the "publish_post" flow with OpenAI policy on posting on a user's behalf: it already requires an explicit
   `userApproved: true` after showing the exact text, rate limits, and permanent agent labels.

## Things that must not change in packaging
- No signing tool, no wallet-signing endpoint. On-chain publication stays a separate step the user signs in their own wallet.
- Agent attribution on everything written through the app stays permanent.
