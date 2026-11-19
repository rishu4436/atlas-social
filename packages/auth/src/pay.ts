/**
 * ATLAS Pay — official Binance Agentic Wallet (`baw`) fallback, browser-safe.
 *
 * Verified 2026-11-19 against binance-skills-hub/skills/binance-web3/binance-agentic-wallet/references/
 * send.md and domain-resolve.md (copies in docs/research/skills-hub/). ATLAS never runs these commands, never
 * signs and never holds funds; the user runs them in their own terminal/agent.
 *
 * The documented flow is: resolve-domain → show the FULL address + mandatory warnings → the user confirms in a
 * LATER step → send with the resolved address (never the domain) → a txHash only means "broadcast".
 */

export const BAW_NATIVE_TOKEN = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" as const;
export const BSC_USDT = "0x55d398326f99059fF775485246999027B3197955" as const;
export type PayAsset = "BNB" | "USDT";

/** Wording required by domain-resolve.md (kept verbatim). */
export const BAW_FALLBACK_WARNING =
  "⚠️ This domain has no address set for this chain. The address above is the domain's default address, not one its owner set for this chain. The owner may not control it on this chain, and funds sent there may not be recoverable. Please verify the address with the domain owner before continuing.";
export const BAW_CONTRACT_WARNING =
  "⚠️ This domain resolves to a smart contract address, not a regular wallet. Many contracts cannot receive funds or return them, so tokens sent here may be locked permanently. Only continue if you know this contract is meant to receive this token on this chain.";
export const BAW_UNKNOWN_NOTE = "I could not verify whether this address is a regular wallet or a contract.";
export const BAW_ADDRESS_BOOK_WARNING =
  "This resolved address must already be in your Binance App address book before it can be used as a transfer recipient. If it isn't, add it in Binance App → Wallet → Settings → Address Book, then retry the transfer.";
export const BAW_BROADCAST_NOTE =
  "A txHash means the transfer was broadcast, not confirmed. It is pending until it is mined; track it with `baw wallet tx-history --json` and wait for on-chain confirmation before treating it as complete.";

export const BAW_RESOLVE_ERRORS: Record<string, { title: string; message: string }> = {
  "20003005": { title: "Unsupported domain format", message: "The name has no dot, or its TLD isn't recognized by the backend. Do not retry with a changed name." },
  "20003006": { title: "Chain not compatible", message: "BSC (56) isn't compatible with this domain's TLD, per the backend. Do not switch chains on your own." },
  "20003007": { title: "No address bound on this chain", message: "The domain resolved but has no address record for BSC. Payment is blocked: ask the recipient to set one." },
};

const AMOUNT = /^(?:0|[1-9]\d{0,29})(?:\.\d{1,18})?$/;
const AGENT_NAME = /^[a-z0-9][a-z0-9_-]{0,62}\.ai$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export const isPayAmount = (s: string) => AMOUNT.test(s) && /[1-9]/.test(s);
export const isAgentName = (s: string) => AGENT_NAME.test(s);
export const isAddress = (s: string) => ADDRESS.test(s);

export function tokenAddressFor(asset: PayAsset) {
  return asset === "BNB" ? BAW_NATIVE_TOKEN : BSC_USDT;
}

/** Step 1: resolve. Only the recipient's verified Agent ID name (validated, so nothing else can ride along). */
export function bawResolveCommand(agentName: string) {
  if (!isAgentName(agentName)) throw new Error("not an Agent ID name");
  return `baw wallet resolve-domain --name ${agentName} --binanceChainId 56 --json`;
}

/** Step 3 (only after the user confirmed the resolved address): send. `--recipient` is always an address. */
export function bawSendCommand(args: { recipient: string; asset: PayAsset; amount: string; gasLevel?: "LOW" | "MEDIUM" | "HIGH" }) {
  if (!isAddress(args.recipient)) throw new Error("--recipient must be the resolved 0x address, never a domain");
  if (!isPayAmount(args.amount)) throw new Error("bad amount");
  const gas = args.gasLevel && args.gasLevel !== "MEDIUM" ? ` --gasLevel ${args.gasLevel}` : "";
  return `baw wallet send --amount ${args.amount} --recipient ${args.recipient} --binanceChainId 56 --tokenAddress ${tokenAddressFor(args.asset)}${gas} --json`;
}

export interface BawResolveResult {
  ok: boolean;
  name?: string;
  address?: string;
  isFallback?: boolean;
  addressType?: "EOA" | "CONTRACT" | "UNKNOWN";
  chainId?: string;
  errorCode?: string;
  error?: string;
  /** Mandatory warnings to show (each its own paragraph) before asking for ONE explicit confirmation. */
  warnings: string[];
}

/** Parses pasted `baw wallet resolve-domain --json` output. Anything unexpected blocks (never guesses). */
export function parseBawResolve(text: string, expectedName?: string): BawResolveResult {
  const t = text.trim();
  let j: any;
  try {
    j = JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1));
  } catch {
    const code = /\b(2000300[5-7])\b/.exec(t)?.[1];
    if (code) return { ok: false, errorCode: code, error: `${BAW_RESOLVE_ERRORS[code]!.title}: ${BAW_RESOLVE_ERRORS[code]!.message}`, warnings: [] };
    return { ok: false, error: "That doesn't look like `baw wallet resolve-domain --json` output. Paste the whole JSON.", warnings: [] };
  }
  const code = String(j?.code ?? j?.errorCode ?? j?.error?.code ?? "");
  if (j?.success === false || BAW_RESOLVE_ERRORS[code]) {
    const known = BAW_RESOLVE_ERRORS[code];
    return { ok: false, errorCode: code || undefined, error: known ? `${known.title}: ${known.message}` : `Resolve failed: ${String(j?.message ?? j?.msg ?? "unknown error").slice(0, 200)}. Payment is blocked.`, warnings: [] };
  }
  const d = j?.data ?? j;
  if (!d || !isAddress(String(d.address ?? ""))) return { ok: false, error: "No resolved address in the output. Payment is blocked.", warnings: [] };
  if (String(d.binanceChainId ?? "56") !== "56") return { ok: false, error: `Resolved for chain ${d.binanceChainId}, not BSC (56). Resolve again with --binanceChainId 56.`, warnings: [] };
  if (expectedName && String(d.name ?? "").toLowerCase() !== expectedName.toLowerCase())
    return { ok: false, error: `This output is for ${d.name}, not ${expectedName}. Every new resolution needs a new confirmation.`, warnings: [] };
  const addressType = ["EOA", "CONTRACT", "UNKNOWN"].includes(d.addressType) ? d.addressType : "UNKNOWN";
  const warnings: string[] = [];
  if (d.isFallback === true) warnings.push(BAW_FALLBACK_WARNING);
  if (addressType !== "EOA") warnings.push(addressType === "UNKNOWN" ? `${BAW_UNKNOWN_NOTE} ${BAW_CONTRACT_WARNING}` : BAW_CONTRACT_WARNING);
  return { ok: true, name: String(d.name), address: String(d.address), isFallback: d.isFallback === true, addressType, chainId: "56", warnings };
}
