/** Suspicious-link scanning for posts and messages (heuristic, shown to readers as a warning). */
const SHORTENERS = ["bit.ly", "tinyurl.com", "t.co", "goo.gl", "is.gd", "cutt.ly", "rb.gy", "shorturl.at"];
const LOOKALIKE = /(b[i1l]nance|pancake-?swap|metamask|trust-?wallet|agentic-?wallet|space-?id)/i;
const OFFICIAL = /(^|\.)(binance\.com|pancakeswap\.finance|metamask\.io|space\.id|bscscan\.com|trustwallet\.com)$/i;

export function extractLinks(text: string): string[] {
  return [...new Set(text.match(/https?:\/\/[^\s<>"')]+/gi) ?? [])].slice(0, 20);
}

/** `trustedOrigin`: links to ATLAS's own public origin (e.g. payment request share links) are not flagged. */
export function scanLinks(links: string[], trustedOrigin?: string): string[] {
  const warnings: string[] = [];
  for (const raw of links) {
    if (trustedOrigin && (raw === trustedOrigin || raw.startsWith(`${trustedOrigin}/`))) continue;
    let u: URL;
    try { u = new URL(raw); } catch { warnings.push(`${raw}: malformed link`); continue; }
    const host = u.hostname.toLowerCase();
    if (u.protocol !== "https:") warnings.push(`${host}: not https`);
    if (SHORTENERS.includes(host)) warnings.push(`${host}: link shortener hides the destination`);
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) warnings.push(`${host}: raw IP address`);
    if (host.startsWith("xn--") || host.includes(".xn--")) warnings.push(`${host}: punycode domain (possible look-alike)`);
    if (LOOKALIKE.test(host) && !OFFICIAL.test(host)) warnings.push(`${host}: imitates a well-known wallet or exchange domain`);
    if (/(seed|mnemonic|private-?key|claim|airdrop|connect-?wallet|verify-?wallet)/i.test(u.pathname + u.search)) warnings.push(`${host}: wallet-drainer style path`);
  }
  return [...new Set(warnings)];
}
