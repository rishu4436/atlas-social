/**
 * Strict check of an ATLAS AtlasLogin EIP-712 payload BEFORE anyone previews or signs it.
 * Dependency-free on purpose: the same file is vendored into tools/atlas-baw-connect (a drift test keeps them equal).
 * Accepts the eth_signTypedData_v4 JSON (string or object), with or without the EIP712Domain type.
 */
export const ATLAS_LOGIN_DOMAIN_NAME = "ATLAS Social";
export const ATLAS_LOGIN_DOMAIN_VERSION = "1";
export const ATLAS_LOGIN_STATEMENT =
  "Sign in to ATLAS Social with your Agent ID. This signature only proves wallet ownership. It does not authorize any transaction, transfer or token approval.";
export const ATLAS_LOGIN_FIELDS = ["purpose", "statement", "audience", "wallet", "loginId", "nonce", "issuedAt", "expiresAt"] as const;
const FIELD_TYPES = ["string", "string", "string", "address", "string", "bytes32", "uint256", "uint256"];
const MAX_TTL = 15 * 60; // a login message may never be valid for longer than this
const SKEW = 120;

export interface AtlasLoginExpectation {
  wallet: string;
  audience: string;
  chainId: number | string;
  loginId?: string;
  /** null/undefined = must be absent; an address = must equal (case-insensitive); "any" = optional, must be an address if present */
  verifyingContract?: string | null;
  now?: number;
}
export interface AtlasLoginCheck {
  ok: boolean;
  problems: string[];
  summary: { site: string; wallet: string; chainId: number; loginId: string; issuedAt: number; expiresAt: number; secondsLeft: number } | null;
}

const lower = (v: unknown) => String(v ?? "").toLowerCase();
const isInt = (v: unknown) => /^\d{1,20}$/.test(String(v));

export function checkAtlasLoginTypedData(input: string | Record<string, any>, exp: AtlasLoginExpectation): AtlasLoginCheck {
  const problems: string[] = [];
  let td: any;
  try { td = typeof input === "string" ? JSON.parse(input) : input; } catch { return { ok: false, problems: ["not valid JSON"], summary: null }; }
  if (!td || typeof td !== "object") return { ok: false, problems: ["not an object"], summary: null };
  const now = exp.now ?? Math.floor(Date.now() / 1000);
  const d = td.domain ?? {}; const m = td.message ?? {};

  if (td.primaryType !== "AtlasLogin") problems.push(`primaryType is ${JSON.stringify(td.primaryType)}, expected AtlasLogin`);
  const typeKeys = Object.keys(td.types ?? {}).filter((k) => k !== "EIP712Domain");
  if (typeKeys.length !== 1 || typeKeys[0] !== "AtlasLogin") problems.push("types must contain only AtlasLogin (plus EIP712Domain)");
  const fields = (td.types?.AtlasLogin ?? []) as { name: string; type: string }[];
  if (fields.length !== ATLAS_LOGIN_FIELDS.length || fields.some((f, i) => f?.name !== ATLAS_LOGIN_FIELDS[i] || f?.type !== FIELD_TYPES[i])) problems.push("AtlasLogin fields differ from the ATLAS login schema");

  // domain
  const domainKeys = Object.keys(d).sort().join(",");
  const anyVc = exp.verifyingContract === "any";
  const allowedKeys = exp.verifyingContract && !(anyVc && d.verifyingContract === undefined) ? "chainId,name,verifyingContract,version" : "chainId,name,version";
  if (domainKeys !== allowedKeys) problems.push(`domain fields are [${domainKeys}], expected [${allowedKeys}]`);
  if (anyVc && d.verifyingContract !== undefined && !/^0x[0-9a-fA-F]{40}$/.test(String(d.verifyingContract))) problems.push("verifyingContract is not an address");
  if (d.name !== ATLAS_LOGIN_DOMAIN_NAME) problems.push(`domain name is ${JSON.stringify(d.name)}`);
  if (String(d.version) !== ATLAS_LOGIN_DOMAIN_VERSION) problems.push(`domain version is ${JSON.stringify(d.version)}`);
  if (String(d.chainId) !== String(exp.chainId)) problems.push(`chain is ${d.chainId}, expected ${exp.chainId}`);
  if (exp.verifyingContract && !anyVc && lower(d.verifyingContract) !== lower(exp.verifyingContract)) problems.push("verifyingContract is not the ATLAS identity registry");

  // message
  const extra = Object.keys(m).filter((k) => !(ATLAS_LOGIN_FIELDS as readonly string[]).includes(k));
  if (extra.length) problems.push(`unexpected message fields: ${extra.join(", ")}`);
  if (m.purpose !== "ATLAS_LOGIN") problems.push("purpose is not ATLAS_LOGIN");
  if (m.statement !== ATLAS_LOGIN_STATEMENT) problems.push("statement is not the ATLAS login statement");
  if (m.audience !== exp.audience) problems.push(`site is ${JSON.stringify(m.audience)}, expected ${exp.audience}`);
  if (!/^0x[0-9a-fA-F]{40}$/.test(String(m.wallet)) || lower(m.wallet) !== lower(exp.wallet)) problems.push("wallet is not your wallet");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(m.loginId))) problems.push("loginId is not a UUID");
  else if (exp.loginId && m.loginId !== exp.loginId) problems.push("loginId does not match this connection");
  if (!/^0x[0-9a-fA-F]{64}$/.test(String(m.nonce)) || /^0x0{64}$/.test(String(m.nonce))) problems.push("nonce is not 32 random bytes");
  const issuedAt = isInt(m.issuedAt) ? Number(m.issuedAt) : NaN;
  const expiresAt = isInt(m.expiresAt) ? Number(m.expiresAt) : NaN;
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)) problems.push("issuedAt/expiresAt are not unix seconds");
  else {
    if (issuedAt > now + SKEW) problems.push("issued in the future");
    if (expiresAt <= now) problems.push("expired");
    if (expiresAt <= issuedAt || expiresAt - issuedAt > MAX_TTL) problems.push(`validity window ${expiresAt - issuedAt}s is outside 1..${MAX_TTL}s`);
  }
  const summary = problems.length && !Number.isFinite(issuedAt) ? null : {
    site: String(m.audience), wallet: String(m.wallet), chainId: Number(d.chainId), loginId: String(m.loginId), issuedAt, expiresAt, secondsLeft: Math.max(0, expiresAt - now),
  };
  return { ok: problems.length === 0, problems, summary };
}
