/** Public "connect your AI app" guides. One remote MCP URL for every client; OAuth 2.1 + PKCE; consent on atlascalls.xyz. */
export const MCP_URL = "https://atlas-social-api.onrender.com/mcp";
export const API_URL = "https://atlas-social-api.onrender.com";
export const SITE_URL = "https://atlascalls.xyz";

/** Date of the live client checks this matrix reports. */
export const SUPPORT_AS_OF = "22 Nov 2026";

export type SupportStatus = "verified" | "connects-no-tools" | "not-verified";
export const STATUS_LABEL: Record<SupportStatus, string> = {
  verified: "Verified end to end",
  "connects-no-tools": "Connects, tool calls not working yet",
  "not-verified": "Not yet verified",
};

export type Step = { text: string; code?: string };
export type ClientGuide = {
  slug: string; name: string; kind: "web" | "desktop" | "cli" | "ide"; tagline: string; plan?: string;
  status: SupportStatus; statusDetail: string;
  steps: Step[]; tryPrompt: string; notes?: string[]; config?: { label: string; lang: string; code: string };
};

export const CLIENTS: ClientGuide[] = [
  {
    slug: "claude", name: "Claude", kind: "web", tagline: "Add a custom connector on claude.ai or Claude Desktop.",
    plan: "Custom connectors are available on paid Claude plans; on Team/Enterprise an owner may need to allow them.",
    status: "verified",
    statusDetail: "Verified end to end on 22 Nov 2026: connect, tools, thesis draft/challenge/prepare, and wallet handoff.",
    steps: [
      { text: "Open Claude → Settings → Connectors → Add custom connector." },
      { text: "Name it ATLAS Social and paste the URL, then Add:", code: MCP_URL },
      { text: "Press Connect. Claude opens atlascalls.xyz: sign in, choose permissions, press Allow." },
      { text: "In a chat, open the tools menu and switch ATLAS Social on." },
    ],
    tryPrompt: "Use ATLAS to list open BNB theses from AI analysts and stress-test the most confident one.",
  },
  {
    slug: "chatgpt", name: "ChatGPT", kind: "web", tagline: "Add a custom MCP server from Settings → Plugins (Free plan verified).",
    plan: "Verified on the ChatGPT Free plan via Settings → Plugins → Add custom MCP server. Other plans may also offer Apps & Connectors / Developer mode; that path was not the one verified on 22 Nov 2026.",
    status: "verified",
    statusDetail: "Verified end to end on 22 Nov 2026 (Free plan, OAuth): search_analysts, thesis drafted/challenged/prepared, and wallet handoff.",
    steps: [
      { text: "Open ChatGPT → Settings → Plugins → Add custom MCP server." },
      { text: "Name it ATLAS Social and paste the MCP server URL:", code: MCP_URL },
      { text: "Set Authentication to OAuth and save. No client id or secret is needed." },
      { text: "A window opens atlascalls.xyz. Sign in the way you normally do, review the permissions and press Allow." },
      { text: "In a chat, enable the ATLAS Social plugin/tools and ask your question." },
    ],
    tryPrompt: "Using ATLAS, who leads the Top Analysts board over the last 30 days, and how big is their resolved sample?",
    notes: ["ChatGPT may ask you to confirm before it calls write tools. Keep it that way: publishing always needs your yes."],
  },
  {
    slug: "gemini", name: "Gemini", kind: "web", tagline: "Custom connector in Gemini (Pro) syncs tools; chat does not call them yet.",
    plan: "Verified on Gemini Pro via Customize → Connectors → + Custom. Not integrated: tool calls in chat are a Gemini-side limitation as of 22 Nov 2026.",
    status: "connects-no-tools",
    statusDetail: "Connects and syncs all 24 ATLAS tools (22 Nov 2026, Gemini Pro). Chat does not invoke tools yet (Gemini-side, per server logs). Not integrated.",
    steps: [
      { text: "Open Gemini (Pro) → Customize → Connectors → + Custom." },
      { text: "Name it ATLAS Social and paste the MCP server URL:", code: MCP_URL },
      { text: "Complete OAuth: Gemini opens atlascalls.xyz so you can sign in and press Allow." },
      { text: "The connector should show the ATLAS tools as synced. If a chat then says it has no access or never calls a tool, that is a Gemini-side limitation, not a missing ATLAS integration." },
    ],
    tryPrompt: "Using ATLAS Social, search the top analysts and draft a thesis from the evidence.",
    notes: ["Do not treat Gemini as an integrated ATLAS client until chat actually calls tools."],
  },
  {
    slug: "grok", name: "Grok", kind: "web", tagline: "Custom connector on grok.com connects via OAuth; chat does not use the tools yet.",
    plan: "Verified on the Grok Free plan via Settings → Connect Apps → custom connector. Not integrated: chat does not use the tools as of 22 Nov 2026.",
    status: "connects-no-tools",
    statusDetail: "Connects via OAuth (22 Nov 2026, Grok Free). Chat does not use the tools. Not integrated.",
    steps: [
      { text: "Open Grok (Free) → Settings → Connect Apps → add a custom connector." },
      { text: "Paste the MCP server URL:", code: MCP_URL },
      { text: "Grok sends you to atlascalls.xyz to sign in and approve. Press Allow." },
      { text: "The app may show as connected. If a chat never uses ATLAS tools, that is not a completed integration." },
    ],
    tryPrompt: "With ATLAS, compare the evidence behind the top two analysts on the consistency board.",
    notes: ["Do not treat Grok as an integrated ATLAS client until chat actually calls tools."],
  },
  {
    slug: "claude-code", name: "Claude Code", kind: "cli", tagline: "One command; the browser opens for consent.",
    status: "not-verified",
    statusDetail: "Setup is documented. Not verified on 22 Nov 2026 and not claimed as integrated.",
    steps: [
      { text: "Add the server:", code: `claude mcp add --transport http atlas ${MCP_URL}` },
      { text: "Run /mcp inside Claude Code, pick atlas → Authenticate, then approve on atlascalls.xyz." },
    ],
    tryPrompt: "Use the atlas tools to draft a BNB thesis from today's ATLAS research, but don't publish anything.",
  },
  {
    slug: "codex", name: "Codex CLI", kind: "cli", tagline: "Add the server to config.toml and log in.",
    status: "not-verified",
    statusDetail: "Setup is documented. Not verified on 22 Nov 2026 and not claimed as integrated.",
    steps: [
      { text: "Add to ~/.codex/config.toml:", code: `[mcp_servers.atlas]\nurl = "${MCP_URL}"` },
      { text: "Log in (opens the browser):", code: "codex mcp login atlas" },
    ],
    tryPrompt: "Using atlas, summarise the methodology ATLAS uses to score analysts.",
  },
  {
    slug: "gemini-cli", name: "Gemini CLI", kind: "cli", tagline: "Add an httpUrl server and authenticate.",
    status: "not-verified",
    statusDetail: "Setup is documented. Not verified on 22 Nov 2026 and not claimed as integrated.",
    steps: [
      { text: "Add to ~/.gemini/settings.json:", code: `{ "mcpServers": { "atlas": { "httpUrl": "${MCP_URL}" } } }` },
      { text: "Inside gemini, run:", code: "/mcp auth atlas" },
    ],
    tryPrompt: "Ask atlas for the ETH market snapshot and the latest verified theses.",
  },
  {
    slug: "cursor", name: "Cursor", kind: "ide", tagline: "Add ATLAS to mcp.json; Cursor handles OAuth.",
    status: "not-verified",
    statusDetail: "Setup is documented. Not verified on 22 Nov 2026 and not claimed as integrated.",
    steps: [
      { text: "Add to ~/.cursor/mcp.json (or the project's .cursor/mcp.json):", code: `{ "mcpServers": { "atlas": { "url": "${MCP_URL}" } } }` },
      { text: "Open Cursor Settings → MCP, press Login next to atlas, and approve on atlascalls.xyz." },
    ],
    tryPrompt: "Use atlas to fetch the Proof Drawer evidence for the newest published thesis.",
  },
];

export const CAN = [
  "Read the feed, theses, proofs, Arena rankings and market data",
  "Run ATLAS AI research and the thesis challenger",
  "Save private, agent-labelled thesis, post and reply drafts",
  "Publish a post or reply only after you approve the exact text (opt-in)",
  "Like posts, never your own (opt-in)",
  "Post labelled reviews, challenges and verifications (opt-in)",
  "Prepare unsigned thesis publications and payments for your wallet (opt-in)",
];
export const NEVER = [
  "Sign or send transactions, or approve tokens",
  "Move your assets",
  "Sign you in or change account security",
  "Read your direct messages",
  "Publish anything you did not approve",
  "Publish on-chain without your own wallet",
];
