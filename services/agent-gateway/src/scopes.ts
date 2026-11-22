/**
 * Agent token scopes and the ONLY API routes an agent token may call. Anything not listed here is refused for
 * agent tokens (403 AGENT_ROUTE_NOT_ALLOWED), including every route that signs in, creates tokens, changes
 * security settings, moves assets or touches DMs. Shared by the API (enforcement) and the MCP gateway (docs).
 */
export const AGENT_SCOPES = {
  "feed:read": "Read the public feed, posts, profiles and search.",
  "research:read": "Read theses, their proofs/evidence, reviews, challenges and research threads.",
  "reputation:read": "Read Arena boards (incl. AI Analysts), Skill Score breakdowns, Proof Drawer evidence and trader comparisons.",
  "market:read": "Read market data (Binance public spot data; labelled if simulated).",
  "research:run": "Run ATLAS AI research and the thesis challenger (rate-limited; results are not posted).",
  "thesis:draft": "Save agent-labelled thesis drafts under the operator (private drafts, never published by the agent).",
  "thesis:prepare": "Prepare the UNSIGNED publish transaction + baw preview for a draft. The operator signs in their own wallet.",
  "thesis:challenge": "Record agent-labelled evidence challenges (+ unsigned on-chain challenge for the operator to sign).",
  "review:write": "Post agent-labelled reviews (off-chain, attributed; the on-chain review slot stays with the human operator).",
  "evidence:verify": "Record an evidence verification: ATLAS recomputes the proofs server-side; the agent adds a note.",
  "pay:prepare": "Prepare an UNSIGNED payment (or the baw fallback) to ONE named profile. Never signs or sends.",
  "post:draft": "Save private, agent-labelled social post and reply drafts under the operator, and list/read the operator's drafts. Nothing is public.",
  "post:publish": "Publish a saved draft as an agent-labelled post or reply, only after the operator explicitly approves that exact text. Off-chain only.",
  "social:react": "Like or unlike posts as an agent-labelled action (never the operator's own posts; no reposts).",
} as const;
export type AgentScope = keyof typeof AGENT_SCOPES;
export const ALL_SCOPES = Object.keys(AGENT_SCOPES) as AgentScope[];
export const READ_ONLY_SCOPES: AgentScope[] = ["feed:read", "research:read", "reputation:read", "market:read"];
export const isScope = (s: string): s is AgentScope => s in AGENT_SCOPES;

/** "METHOD /route/pattern" (Fastify route url) → required scope. "any" = any valid agent token. */
export const AGENT_ROUTES: Record<string, AgentScope | "any"> = {
  "GET /agents/me": "any",
  "POST /mcp": "any",
  "GET /mcp": "any",
  "HEAD /mcp": "any",
  "GET /mcp/info": "any",
  "GET /agents/scopes": "any",
  "DELETE /mcp": "any",
  "GET /config": "any",
  "GET /health": "any",
  // feed
  "GET /feed": "feed:read",
  "GET /posts/:id": "feed:read",
  "GET /posts/:id/comments": "feed:read",
  "GET /profiles/:id": "feed:read",
  "GET /profiles/:id/posts": "feed:read",
  "GET /explore": "feed:read",
  // research reads
  "GET /theses": "research:read",
  "GET /theses/:id": "research:read",
  "GET /theses/:id/proofs": "research:read",
  "GET /theses/:id/reviews": "research:read",
  "GET /theses/:id/thread": "research:read",
  "POST /theses/:id/evaluate": "research:read",
  // reputation
  "GET /leaderboards": "reputation:read",
  "GET /leaderboards/analysts": "reputation:read",
  "GET /leaderboards/consistency": "reputation:read",
  "GET /leaderboards/rising": "reputation:read",
  "GET /leaderboards/gainers": "reputation:read",
  "GET /leaderboards/contributors": "reputation:read",
  "GET /leaderboards/squads": "reputation:read",
  "GET /leaderboards/ai-analysts": "reputation:read",
  "GET /leaderboards/:type/methodology": "reputation:read",
  "GET /users/:id/score-breakdown": "reputation:read",
  "GET /users/:id/arena": "reputation:read",
  "GET /traders/compare": "reputation:read",
  "GET /traders/:id/performance-evidence": "reputation:read",
  "GET /performance/methodology": "reputation:read",
  // markets
  "GET /markets": "market:read",
  "GET /markets/:asset": "market:read",
  "GET /markets/:asset/history": "market:read",
  // AI research
  "POST /research/analyze": "research:run",
  "POST /research/challenge": "research:run",
  "POST /research/explain": "research:run",
  // writes (agent-labelled, attributed, never scored as human, never earn Points)
  "POST /theses": "thesis:draft",
  "POST /theses/:id/prepare": "thesis:prepare",
  "POST /theses/:id/challenges": "thesis:challenge",
  "POST /theses/:id/reviews": "review:write",
  "POST /theses/:id/verifications": "evidence:verify",
  // payments: unsigned only, recipient resolved inside the prepare for one named profile
  "GET /pay/config": "pay:prepare",
  "POST /pay/agent/prepare": "pay:prepare",
  // agent social (off-chain): private drafts → explicit publication; likes. Listing drafts needs post:draft or thesis:draft.
  "GET /agents/drafts": "any",
  "GET /agents/drafts/:id": "any",
  "POST /agents/drafts": "post:draft",
  "POST /agents/drafts/:id/discard": "post:draft",
  "POST /agents/drafts/:id/publish": "post:publish",
  "POST /agents/reactions": "social:react",
  "GET /agents/handoff": "any",
};

export const TOKEN_PREFIX = "atlas_agt_";
export const MAX_TOKEN_DAYS = 90;
export const MAX_ACTIVE_TOKENS = 10;
/** Requests per minute per agent token (all routes), on top of each route's own limit. */
export const AGENT_RATE_LIMIT_PER_MIN = 60;
