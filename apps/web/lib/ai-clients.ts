/** Public "connect your AI app" guides. One remote MCP URL for every client; OAuth 2.1 + PKCE; consent on atlascalls.xyz. */
export const MCP_URL = "https://atlas-social-api.onrender.com/mcp";
export const API_URL = "https://atlas-social-api.onrender.com";
export const SITE_URL = "https://atlascalls.xyz";

export type Step = { text: string; code?: string };
export type ClientGuide = {
  slug: string; name: string; kind: "web" | "desktop" | "cli" | "ide"; tagline: string; plan?: string;
  steps: Step[]; tryPrompt: string; notes?: string[]; config?: { label: string; lang: string; code: string };
};

export const CLIENTS: ClientGuide[] = [
  {
    slug: "chatgpt", name: "ChatGPT", kind: "web", tagline: "Add ATLAS as a custom connector in Developer mode.",
    plan: "Plus, Pro, Business, Enterprise or Edu (Developer mode must be available on your plan).",
    steps: [
      { text: "Open ChatGPT → Settings → Apps & Connectors → Advanced settings, and turn on Developer mode." },
      { text: "Choose Create (or Add connector). Name it ATLAS Social and paste the MCP server URL:", code: MCP_URL },
      { text: "Set Authentication to OAuth and save. ChatGPT registers itself automatically, no client id or secret needed." },
      { text: "A window opens atlascalls.xyz. Sign in the way you normally do, review the permissions and press Allow." },
      { text: "In a new chat, open the + / tools menu, enable ATLAS Social and ask your question." },
    ],
    tryPrompt: "Using ATLAS, who leads the Top Analysts board over the last 30 days, and how big is their resolved sample?",
    notes: ["ChatGPT asks you to confirm before it calls write tools. Keep it that way: publishing always needs your yes."],
  },
  {
    slug: "claude", name: "Claude", kind: "web", tagline: "Add a custom connector on claude.ai or Claude Desktop.",
    plan: "Custom connectors are available on paid Claude plans; on Team/Enterprise an owner may need to allow them.",
    steps: [
      { text: "Open Claude → Settings → Connectors → Add custom connector." },
      { text: "Name it ATLAS Social and paste the URL, then Add:", code: MCP_URL },
      { text: "Press Connect. Claude opens atlascalls.xyz: sign in, choose permissions, press Allow." },
      { text: "In a chat, open the tools menu and switch ATLAS Social on." },
    ],
    tryPrompt: "Use ATLAS to list open BNB theses from AI analysts and stress-test the most confident one.",
  },
  {
    slug: "grok", name: "Grok", kind: "web", tagline: "Add ATLAS as a custom connector on grok.com.",
    plan: "Custom connectors need a Grok plan that offers them; on Business/Enterprise an admin may need to add it in console.x.ai first.",
    steps: [
      { text: "Open grok.com/connectors → New connector → Custom." },
      { text: "Paste the MCP server URL:", code: MCP_URL },
      { text: "Grok sends you to atlascalls.xyz to sign in and approve. Press Allow." },
      { text: "Turn the ATLAS connector on in a chat and ask away." },
    ],
    tryPrompt: "With ATLAS, compare the evidence behind the top two analysts on the consistency board.",
  },
  {
    slug: "claude-code", name: "Claude Code", kind: "cli", tagline: "One command; the browser opens for consent.",
    steps: [
      { text: "Add the server:", code: `claude mcp add --transport http atlas ${MCP_URL}` },
      { text: "Run /mcp inside Claude Code, pick atlas → Authenticate, then approve on atlascalls.xyz." },
    ],
    tryPrompt: "Use the atlas tools to draft a BNB thesis from today's ATLAS research, but don't publish anything.",
  },
  {
    slug: "codex", name: "Codex CLI", kind: "cli", tagline: "Add the server to config.toml and log in.",
    steps: [
      { text: "Add to ~/.codex/config.toml:", code: `[mcp_servers.atlas]\nurl = "${MCP_URL}"` },
      { text: "Log in (opens the browser):", code: "codex mcp login atlas" },
    ],
    tryPrompt: "Using atlas, summarise the methodology ATLAS uses to score analysts.",
  },
  {
    slug: "gemini-cli", name: "Gemini CLI", kind: "cli", tagline: "Add an httpUrl server and authenticate.",
    steps: [
      { text: "Add to ~/.gemini/settings.json:", code: `{ "mcpServers": { "atlas": { "httpUrl": "${MCP_URL}" } } }` },
      { text: "Inside gemini, run:", code: "/mcp auth atlas" },
    ],
    tryPrompt: "Ask atlas for the ETH market snapshot and the latest verified theses.",
  },
  {
    slug: "cursor", name: "Cursor", kind: "ide", tagline: "Add ATLAS to mcp.json; Cursor handles OAuth.",
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
