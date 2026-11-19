/**
 * Agent ID onboarding helpers shared by the API and the web wizard.
 *
 * Pure TypeScript (no viem, no Node APIs) so the browser can import it via `@atlas/auth/onboarding`.
 * Nothing here signs, sends or stores anything. It explains errors, checks pasted input locally and
 * quotes the `baw` commands for each shell.
 */

export type AuthAction =
  | "regenerate" // issue a fresh challenge (old commands become stale)
  | "fix-input" // correct what was pasted
  | "fallback" // switch to the on-chain registerIdentity proof
  | "wait" // retry after a pause
  | "claim" // get an Agent ID first
  | "enable-devmode" // turn on Developer Mode in the Binance App
  | "signin-baw" // sign the CLI in to your own wallet
  | "approve-app" // approve in the Binance App, then fetch the result
  | "stop" // do not continue (risk block / suspended / wrong account)
  | "passkey" // passkey-specific recovery
  | "contact"; // needs a human

export interface AuthErrorInfo {
  title: string;
  /** what happened, in plain words */
  message: string;
  /** what to do next */
  fix: string;
  action: AuthAction;
  /** true when the guided on-chain registerIdentity path is the right next step */
  fallback: boolean;
}

const E = (title: string, message: string, fix: string, action: AuthAction, fallback = false): AuthErrorInfo => ({ title, message, fix, action, fallback });

/**
 * Every error code the sign-in flow can produce (API codes and codes detected locally from pasted `baw`
 * output), mapped to a human explanation and a fix. Codes are stable; clients switch on them.
 */
export const AUTH_ERRORS = {
  // ---- challenge lifecycle
  EXPIRED: E("Challenge expired", "Each ATLAS challenge is valid for 5 minutes and this one ran out. That protects you if a signature leaks later.", "Generate a new challenge and run the new commands. Commands from the old challenge will not work.", "regenerate"),
  ALREADY_USED: E("Challenge already used", "This challenge was already used or burned by a rejected attempt. Every challenge works exactly once, so a copied signature can never be replayed.", "Generate a new challenge and sign the new commands.", "regenerate"),
  CHALLENGE_SUPERSEDED: E("Old commands", "You generated a newer challenge, so these commands were invalidated.", "Use the commands shown now (the newest challenge).", "regenerate"),
  CHALLENGE_NOT_FOUND: E("Unknown challenge", "The server does not know this challenge. It may be from another device, tab or deployment.", "Generate a new challenge on this page.", "regenerate"),
  CHALLENGE_CONTEXT_MISMATCH: E("Challenge belongs to another session", "This proof was started in a different session.", "Start the verification again from this tab.", "regenerate"),
  AUDIENCE_MISMATCH: E("Wrong website", "The challenge was issued for a different ATLAS address. A signature made for another site is useless here, which is what protects you from phishing.", "Open ATLAS at its real address and start again.", "regenerate"),
  CHAIN_MISMATCH: E("Chain mismatch", "The challenge was signed for a different chain than ATLAS uses (BNB Smart Chain, chain 56 in production).", "Run the commands exactly as generated. Do not change --binanceChainId.", "regenerate"),

  // ---- signature content
  SIGNATURE_REQUIRED: E("No signature", "Nothing was pasted in the signature field.", "Paste the full `signature` value from `baw sign-message execute` or `result`.", "fix-input"),
  SIGNATURE_TRUNCATED: E("Signature looks cut off", "A signature is 64 or 65 bytes (128 or 130 hex characters). What you pasted is shorter, which usually means the terminal wrapped or truncated it.", "Copy the whole `signature` value again. Using --json output and copying the quoted value avoids line wraps.", "fix-input"),
  MALFORMED_SIGNATURE: E("Signature isn't valid hex", "The signature must be hexadecimal (0-9, a-f), optionally starting with 0x, with no spaces or quotes.", "Paste only the `signature` value, without quotes, spaces or line breaks.", "fix-input"),
  BAD_RECOVERY: E("Recovery value looks wrong", "The recovery value must be 00, 01, 1b or 1c (from `signatureRecovery`).", "Paste `signatureRecovery` exactly, or leave it empty and ATLAS will try both.", "fix-input"),
  SIGNER_MISMATCH: E("Signature doesn't match this wallet", "The signature is valid, but it was not made by the wallet you entered for this exact challenge. Usually baw is signed in to a different wallet, or the commands came from an older challenge.", "Check `baw wallet address --json` matches the wallet above, then sign the current commands. Rejected attempts burn the challenge, so you'll get new commands.", "regenerate"),
  BAD_SIGNATURE: E("Signature rejected", "The signature does not prove ownership of this wallet for this challenge.", "Sign the current commands with the wallet that holds your Agent ID.", "regenerate"),
  ERC1271_REJECTED: E("Smart-wallet check failed", "This wallet is a smart contract and it did not approve the signature (ERC-1271).", "Use the on-chain proof instead: one registerIdentity transaction from the same wallet.", "fallback", true),
  WALLET_MISMATCH: E("Proof came from another wallet", "The on-chain proof was sent from a different wallet than the one you entered.", "Send registerIdentity from the wallet that holds your Agent ID.", "regenerate"),

  // ---- Agent ID / account
  NOT_AGENT_ID_HOLDER: E("No Agent ID on this wallet", "ATLAS checked the official Agent ID registry live and this wallet does not hold an Agent ID.", "Claim one in the Binance App (Web3 wallet → Agent ID), then enter the wallet that holds it. `baw wallet agent-id --json` shows whether you have one.", "claim"),
  AGENT_ID_NOT_HELD: E("Agent ID no longer held", "This wallet no longer holds the Agent ID linked to your account.", "Use the wallet that holds the linked Agent ID.", "stop"),
  AGENT_ID_ALREADY_REGISTERED: E("Already registered", "This Agent ID or wallet already belongs to an ATLAS account. One Agent ID maps to exactly one account.", "Sign in with that account, or use its passkey.", "stop"),
  WALLET_CHANGED: E("Agent ID linked to another wallet", "This Agent ID is already linked to a different wallet. ATLAS never silently replaces the verified wallet.", "Sign in with the originally linked wallet, or contact support to re-verify.", "contact"),
  IDENTITY_MISMATCH: E("Wallet linked to another Agent ID", "This wallet is already linked to a different Agent ID.", "Sign in with the Agent ID that is linked to this wallet.", "stop"),
  AGENT_ID_REVOKED: E("Association revoked", "This Agent ID's association with ATLAS was revoked.", "Contact support to re-verify.", "contact"),
  ACCOUNT_SUSPENDED: E("Account suspended", "This account is suspended.", "Contact support.", "contact"),
  ACCOUNT_UNAVAILABLE: E("Account unavailable", "The account linked to this passkey is unavailable.", "Sign in with your Agent ID wallet instead.", "contact"),

  // ---- on-chain fallback
  CONTRACTS_PENDING: E("Contracts pending deployment", "The ATLAS registries are not deployed on this chain yet, so the on-chain proof cannot run. Nothing was sent or recorded.", "Use the signature path for now. The on-chain proof opens once the contracts are deployed and verified.", "wait"),
  PROOF_PENDING: E("Transaction not found yet", "ATLAS could not find your registerIdentity transaction on-chain yet. It may still be confirming.", "Wait about 10 seconds for confirmation, then press verify again.", "wait"),

  // ---- transport
  RATE_LIMITED: E("Too many attempts", "Sign-in endpoints allow 20 attempts per minute per network address.", "Wait a minute, then try again.", "wait"),
  BAD_ORIGIN: E("Blocked cross-site request", "The request came from a page that isn't ATLAS.", "Open ATLAS directly and try again.", "stop"),
  VALIDATION: E("Invalid input", "Something in the request wasn't in the expected format.", "Check the wallet address (0x + 40 hex characters) and the pasted values.", "fix-input"),
  NETWORK: E("Can't reach ATLAS", "The ATLAS API didn't answer. On the free tier it sleeps when idle and takes 30–60 seconds to wake.", "Wait a moment and retry.", "wait"),

  // ---- passkeys
  PASSKEY_UNKNOWN: E("Passkey not recognised", "This passkey isn't registered on ATLAS (it may have been removed or made on another site).", "Sign in with your Agent ID wallet, then add a new passkey in Settings → Security.", "passkey"),
  PASSKEY_REJECTED: E("Passkey check failed", "Your device's passkey response couldn't be verified.", "Try again, or sign in with your Agent ID wallet.", "passkey"),
  PASSKEY_CANCELLED: E("Passkey cancelled", "The passkey prompt was closed or timed out.", "Try again. If this device has no ATLAS passkey, sign in with your Agent ID wallet.", "passkey"),
  CHALLENGE_INVALID: E("Passkey challenge expired", "The passkey prompt took longer than 5 minutes or was already used.", "Start the passkey sign-in again.", "passkey"),
  STEP_UP_REQUIRED: E("Fresh wallet proof needed", "Adding a passkey needs a wallet proof from the last 10 minutes.", "Verify with your Agent ID wallet again, then add the passkey.", "regenerate"),

  // ---- detected locally from pasted `baw` output
  BAW_953004: E("Known Agentic Wallet bug (#400, error 953004)", "`baw sign-message preview` fails with 953004 for some EIP-712 logins. This is a known issue in the Agentic Wallet, not something you did wrong.", "Use the on-chain proof: one registerIdentity transaction from your wallet (no value, no approval). It also counts as an on-chain ATLAS interaction.", "fallback", true),
  BAW_DEV_MODE_OFF: E("Developer Mode is off or expired", "External signing needs Developer Mode, which lasts 7 days (error 351802 when expired).", "Binance App → Agentic Wallet → Settings → Developer Mode → accept the risk warning. Then re-run `baw wallet settings --json`.", "enable-devmode"),
  BAW_DEV_MODE_BALANCE_CAP: E("Balance above the Developer Mode cap", "Developer Mode can't be enabled while the wallet balance is over its cap (351804).", "Move funds below the cap in the Binance App, then enable Developer Mode.", "enable-devmode"),
  BAW_RISK_BLOCKED: E("Blocked by wallet risk checks", "The Agentic Wallet intercepted this request as risky (351803). ATLAS offers no way around it, by design.", "Do not execute. Check you're on the real ATLAS site and the preview shows ATLAS Social. Report it to us.", "stop"),
  BAW_PREVIEW_EXPIRED: E("Wallet preview expired", "baw's preview cache expired before execute ran.", "Run the preview command again, then execute with the new requestId.", "fix-input"),
  BAW_NOT_SIGNED_IN: E("baw isn't signed in", "The CLI isn't connected to your wallet.", "Run `baw auth signin` and finish Binance's own sign-in in your Binance App, then check `baw wallet status --json`.", "signin-baw"),
  BAW_SIGN_REJECTED: E("Signature request rejected", "The request was rejected or expired in the Binance App, so no signature exists.", "Run the preview again with a fresh challenge.", "regenerate"),
  BAW_PENDING: E("Waiting for approval in the Binance App", "The signature needs your approval in the Binance App.", "Approve it in the App, then run the result command shown here.", "approve-app"),
  BAW_SIMULATION_FAILED: E("Wallet simulation failed", "The wallet's simulation of the transaction failed (351805).", "Read the message in the output. For registerIdentity it usually means the commitment was already used: generate a new challenge.", "regenerate"),
  BAW_AGENT_ID_SERVICE: E("Agent ID service unavailable", "The Agent ID backend is temporarily unavailable (20003008). This doesn't mean you lack an Agent ID.", "Try again in a minute.", "wait"),
  STALE_PREVIEW: E("Preview is for an old challenge", "This preview output belongs to an older challenge (different loginId), so its signature would be rejected.", "Run the preview command shown now.", "fix-input"),
  WRONG_MESSAGE: E("Preview isn't an ATLAS login", "The parsed message isn't the ATLAS Social login (domain, wallet or type differs). Do not execute it.", "Copy the preview command from this page again, unchanged.", "stop"),
  BAW_UNKNOWN_ERROR: E("baw returned an error", "The Agentic Wallet returned an error ATLAS doesn't recognise.", "Read the error message. If signing keeps failing, use the on-chain proof.", "fallback", true),
} as const satisfies Record<string, AuthErrorInfo>;

export type AuthErrorCode = keyof typeof AUTH_ERRORS;

/** Codes that mean the signature path cannot succeed for this wallet right now; the UI offers the on-chain fallback. */
export const FALLBACK_CODES: AuthErrorCode[] = (Object.keys(AUTH_ERRORS) as AuthErrorCode[]).filter((k) => AUTH_ERRORS[k].fallback);

export function isAuthErrorCode(code: string): code is AuthErrorCode {
  return Object.prototype.hasOwnProperty.call(AUTH_ERRORS, code);
}

export function explainAuthError(code: string, fallbackMessage?: string): AuthErrorInfo & { code: string } {
  if (isAuthErrorCode(code)) return { code, ...AUTH_ERRORS[code] };
  return { code, title: "Something went wrong", message: fallbackMessage ?? "An unexpected error occurred.", fix: "Try again. If it keeps happening, use the on-chain proof or contact support.", action: "fallback", fallback: true };
}

// ------------------------------------------------------------------ signature input (local pre-check)

export type SignatureCheck = { ok: true; signature: string; recovery?: string } | { ok: false; code: "SIGNATURE_REQUIRED" | "SIGNATURE_TRUNCATED" | "MALFORMED_SIGNATURE" | "BAD_RECOVERY" };

/**
 * Checks a pasted signature before it is sent, so a typo doesn't burn the challenge.
 * Accepts 65-byte r|s|v, 64-byte r|s (+ recovery) or longer contract-wallet (ERC-1271) signatures.
 */
export function checkSignatureInput(signature: string, recovery?: string): SignatureCheck {
  const raw = (signature ?? "").trim().replace(/^["']|["']$/g, "");
  if (!raw) return { ok: false, code: "SIGNATURE_REQUIRED" };
  const s = raw.replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]+$/.test(s)) return { ok: false, code: "MALFORMED_SIGNATURE" };
  if (s.length < 128) return { ok: false, code: "SIGNATURE_TRUNCATED" };
  if (s.length % 2 !== 0) return { ok: false, code: "MALFORMED_SIGNATURE" };
  const r = (recovery ?? "").trim().replace(/^["']|["']$/g, "");
  if (r) {
    const v = parseInt(r.replace(/^0x/i, ""), 16);
    if (!/^(0x)?[0-9a-fA-F]{1,2}$/.test(r) || ![0, 1, 27, 28].includes(v)) return { ok: false, code: "BAD_RECOVERY" };
  }
  return { ok: true, signature: `0x${s.toLowerCase()}`, recovery: r || undefined };
}

// ------------------------------------------------------------------ pasted baw output

export interface BawContext {
  wallet: string;
  chainId: number;
  loginId: string;
  audience?: string;
}

export type BawParse =
  | { kind: "preview"; requestId: string; requireConfirmation: boolean; risks: string[]; warning?: AuthErrorCode }
  | { kind: "signature"; status: "COMPLETED"; orderId?: string; signature: string; recovery?: string }
  | { kind: "pending"; orderId: string }
  | { kind: "broadcast"; orderId?: string; txHash: string }
  | { kind: "settings"; devModeOn: boolean; expiresAt?: number }
  | { kind: "agent-id"; claimed: boolean; agentId?: string }
  | { kind: "address"; address: string }
  | { kind: "error"; code: AuthErrorCode; bawCode?: string | number; detail?: string }
  | { kind: "unknown" };

const SAFE_ID = /^[A-Za-z0-9._:\-]{1,200}$/;
/** requestId / orderId values are pasted into shell commands, so only plain identifier characters are allowed. */
export const isSafeBawId = (s: string) => SAFE_ID.test(s);

function extractJson(text: string): any | null {
  const t = text.trim();
  const a = t.indexOf("{");
  const b = t.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(t.slice(a, b + 1)); } catch { return null; }
}

function errorFromBawCode(code: unknown, msg: string): AuthErrorCode {
  const c = String(code ?? "");
  if (c === "953004") return "BAW_953004";
  if (c === "351802") return "BAW_DEV_MODE_OFF";
  if (c === "351804") return "BAW_DEV_MODE_BALANCE_CAP";
  if (c === "351803") return "BAW_RISK_BLOCKED";
  if (c === "351805") return "BAW_SIMULATION_FAILED";
  if (c === "20003008") return "BAW_AGENT_ID_SERVICE";
  if (/UNCONNECTED|not signed in|sign ?in required|AUTH_REQUIRED|unauthori[sz]ed/i.test(`${c} ${msg}`)) return "BAW_NOT_SIGNED_IN";
  if (/developer mode|dev ?mode/i.test(msg)) return "BAW_DEV_MODE_OFF";
  if (/expired/i.test(msg) && /preview|request/i.test(msg)) return "BAW_PREVIEW_EXPIRED";
  return "BAW_UNKNOWN_ERROR";
}

/**
 * Reads output pasted from `baw ... --json` (or plain text) and says what it is and what comes next.
 * Runs in the browser; the pasted text is never sent anywhere.
 */
export function parseBawOutput(text: string, ctx?: BawContext): BawParse {
  if (!text || !text.trim()) return { kind: "unknown" };
  const j = extractJson(text);
  if (!j) {
    if (/953004/.test(text)) return { kind: "error", code: "BAW_953004", bawCode: 953004 };
    const m = text.match(/\b(3518\d\d|20003008)\b/);
    if (m) return { kind: "error", code: errorFromBawCode(m[1], text), bawCode: m[1] };
    const claimed = text.match(/Claimed:\s*(Yes|No)/i);
    if (claimed) return { kind: "agent-id", claimed: /yes/i.test(claimed[1]!), agentId: text.match(/Agent ID:\s*(\S+\.ai)/i)?.[1] };
    if (/UNCONNECTED/.test(text)) return { kind: "error", code: "BAW_NOT_SIGNED_IN" };
    return { kind: "unknown" };
  }
  if (j.success === false || (j.error && !j.data)) {
    const err = j.error ?? {};
    const code = err.code ?? err.name;
    return { kind: "error", code: errorFromBawCode(code, `${err.name ?? ""} ${err.message ?? ""}`), bawCode: code, detail: err.message };
  }
  const d = j.data ?? j;
  if (d.devMode && typeof d.devMode === "object") {
    const exp = Number(d.devMode.expiresAt);
    const nowS = Date.now() / 1000;
    const expS = exp > 1e12 ? exp / 1000 : exp;
    const on = !!d.devMode.enabled && (!exp || expS > nowS);
    return { kind: "settings", devModeOn: on, expiresAt: exp || undefined };
  }
  if (typeof d.claimed === "boolean") return { kind: "agent-id", claimed: d.claimed, agentId: d.agentId };
  if (typeof d.status === "string" && /UNCONNECTED/.test(d.status)) return { kind: "error", code: "BAW_NOT_SIGNED_IN" };
  if (typeof d.requestId === "string" && d.parsedMessage !== undefined) {
    if (!isSafeBawId(d.requestId)) return { kind: "error", code: "BAW_UNKNOWN_ERROR", detail: "requestId has unexpected characters" };
    const risks: string[] = (d.risks?.riskDetails ?? []).map((r: any) => `${r.title ?? r.code}: ${r.description ?? ""}`.trim());
    let warning: AuthErrorCode | undefined;
    const pm = d.parsedMessage?.message;
    if (ctx && typeof pm === "string") {
      let td: any = null;
      try { td = JSON.parse(pm); } catch { /* not JSON */ }
      if (td && typeof td === "object") {
        const msg = td.message ?? {};
        const domainOk = td.domain?.name === "ATLAS Social" && td.primaryType === "AtlasLogin";
        const walletOk = !msg.wallet || String(msg.wallet).toLowerCase() === ctx.wallet.toLowerCase();
        const audienceOk = !ctx.audience || !msg.audience || msg.audience === ctx.audience;
        if (!domainOk || !walletOk || !audienceOk) warning = "WRONG_MESSAGE";
        else if (td.domain?.chainId !== undefined && Number(td.domain.chainId) !== ctx.chainId) warning = "CHAIN_MISMATCH";
        else if (msg.loginId && msg.loginId !== ctx.loginId) warning = "STALE_PREVIEW";
      }
    }
    return { kind: "preview", requestId: d.requestId, requireConfirmation: !!d.requireConfirmation, risks, warning };
  }
  if (typeof d.requestId === "string" && d.parsedTx !== undefined) {
    if (!isSafeBawId(d.requestId)) return { kind: "error", code: "BAW_UNKNOWN_ERROR", detail: "requestId has unexpected characters" };
    const risks: string[] = (d.risks?.riskDetails ?? []).map((r: any) => `${r.title ?? r.code}: ${r.description ?? ""}`.trim());
    return { kind: "preview", requestId: d.requestId, requireConfirmation: !!d.requireConfirmation, risks };
  }
  if (typeof d.status === "string") {
    const orderId = typeof d.orderId === "string" && isSafeBawId(d.orderId) ? d.orderId : undefined;
    if (d.status === "COMPLETED" && typeof d.signature === "string") return { kind: "signature", status: "COMPLETED", orderId, signature: d.signature, recovery: d.signatureRecovery ?? undefined };
    if (d.status === "PENDING_CONFIRMATION") return orderId ? { kind: "pending", orderId } : { kind: "error", code: "BAW_UNKNOWN_ERROR", detail: "missing orderId" };
    if (d.status === "BROADCASTED" && typeof d.txHash === "string") return { kind: "broadcast", orderId, txHash: d.txHash };
    if (d.status === "REJECTED" || d.status === "EXPIRED" || d.status === "FAILED") return { kind: "error", code: "BAW_SIGN_REJECTED", detail: d.status };
  }
  if (typeof d.address === "string" && /^0x[0-9a-fA-F]{40}$/.test(d.address)) return { kind: "address", address: d.address };
  return { kind: "unknown" };
}

// ------------------------------------------------------------------ per-shell quoting

export type ShellKind = "posix" | "powershell" | "cmd";

export const SHELLS: { id: ShellKind; label: string; note: string }[] = [
  { id: "posix", label: "macOS / Linux / WSL", note: "bash or zsh (Terminal on macOS, any Linux shell, or WSL on Windows). The message is wrapped in single quotes so nothing inside is expanded." },
  { id: "powershell", label: "Windows PowerShell 7+", note: "PowerShell 7.3 or newer passes the single-quoted JSON unchanged. Windows PowerShell 5.1 mangles embedded quotes: use the Command Prompt tab or upgrade (winget install Microsoft.PowerShell)." },
  { id: "cmd", label: "Windows Command Prompt", note: "cmd.exe has no single quotes, so the JSON is wrapped in double quotes with every inner quote escaped. Paste it as one line." },
];

/** POSIX sh single-quote quoting. */
export const quotePosix = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
/** PowerShell single-quoted literal (verbatim; '' escapes a quote). */
export const quotePowerShell = (s: string) => `'${s.replace(/'/g, "''")}'`;
/**
 * cmd.exe / MSVCRT argv quoting (what Node uses on Windows to rebuild argv): backslashes before a quote are
 * doubled, quotes become \", and the whole argument is wrapped in double quotes.
 */
export function quoteCmd(s: string): string {
  let out = "";
  let bs = 0;
  for (const ch of s) {
    if (ch === "\\") { bs++; continue; }
    if (ch === '"') { out += "\\".repeat(bs * 2 + 1) + '"'; bs = 0; continue; }
    out += "\\".repeat(bs) + ch; bs = 0;
  }
  out += "\\".repeat(bs * 2);
  return `"${out}"`;
}

export function quoteFor(shell: ShellKind, s: string) {
  return shell === "posix" ? quotePosix(s) : shell === "powershell" ? quotePowerShell(s) : quoteCmd(s);
}

/** The exact follow-up commands, built from IDs the user pasted (validated so the clipboard can't carry anything else). */
export function bawExecuteCommand(requestId: string, kind: "sign-message" | "contract-call" = "sign-message") {
  if (!isSafeBawId(requestId)) throw new Error("unsafe requestId");
  return `baw ${kind} execute --requestId ${requestId} --json`;
}
export function bawResultCommand(orderId: string) {
  if (!isSafeBawId(orderId)) throw new Error("unsafe orderId");
  return `baw sign-message result --order-id ${orderId} --json`;
}
