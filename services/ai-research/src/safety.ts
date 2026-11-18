/**
 * Untrusted-content boundary. Social posts, thesis text and web pages are DATA for the research agents,
 * never instructions. Nothing in ATLAS AI can sign, approve, transfer or call a wallet: the agents have no
 * tools, and their output schema contains no executable fields. These helpers additionally detect and strip
 * signing/transfer instructions so they are never echoed back to users as advice.
 */
const PATTERNS: [RegExp, string][] = [
  [/\bbaw\s+(sign-message|contract-call|wallet\s+send|x402)/i, "wallet CLI command"],
  [/\b(sign|approve|execute)\b[^.\n]{0,60}\b(transaction|tx|message|permit|signature|approval|allowance)\b/i, "signing instruction"],
  [/\b(seed phrase|mnemonic|private key|secret key|pairing code|recovery phrase)\b/i, "credential request"],
  [/\b(send|transfer|withdraw)\b[^.\n]{0,40}\b(all|everything|funds|tokens|bnb|usdt)\b/i, "transfer instruction"],
  [/\bunlimited\s+(approval|allowance)\b|\bsetApprovalForAll\b|0x095ea7b3/i, "approval instruction"],
  [/\bignore (all|any|previous|prior) (instructions|rules)\b|\bsystem prompt\b|\byou are now\b/i, "prompt injection"],
  [/\bscan (this|the) qr\b|\benter (your|the) pairing\b/i, "QR/pairing login"],
];

export interface SafetyScan {
  flagged: boolean;
  reasons: string[];
}

export function scanUntrusted(text: string): SafetyScan {
  const reasons = PATTERNS.filter(([re]) => re.test(text)).map(([, why]) => why);
  return { flagged: reasons.length > 0, reasons: [...new Set(reasons)] };
}

/** Wraps untrusted text for an LLM prompt with an explicit boundary and neutralises fence spoofing. */
export function wrapUntrusted(label: string, text: string): string {
  const cleaned = text.replace(/<\/?untrusted[^>]*>/gi, "[removed-tag]").slice(0, 8000);
  return `<untrusted source="${label}">\n${cleaned}\n</untrusted>`;
}

/** Removes any sentence from model output that contains a wallet/signing instruction. */
export function sanitizeOutput(text: string): { text: string; removed: number } {
  const parts = text.split(/(?<=[.!?\n])\s+/);
  const kept = parts.filter((p) => !scanUntrusted(p).flagged);
  return { text: kept.join(" ").trim(), removed: parts.length - kept.length };
}
