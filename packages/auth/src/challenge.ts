import {
  encodeAbiParameters, keccak256, recoverTypedDataAddress, toHex, isAddressEqual, getAddress,
  type Address, type Hex, type PublicClient,
} from "viem";

export const LOGIN_PURPOSE = "ATLAS_LOGIN" as const;
export const LOGIN_STATEMENT =
  "Sign in to ATLAS Social with your Agent ID. This signature only proves wallet ownership. It does not authorize any transaction, transfer or token approval.";
export const CHALLENGE_TTL_SECONDS = 5 * 60;

export interface LoginChallenge {
  loginId: string; // server-issued UUID
  wallet: Address; // intended signer
  nonce: Hex; // 32 random bytes, single use
  audience: string; // origin, e.g. https://atlas.example
  chainId: number; // 56 in production
  issuedAt: number; // unix seconds
  expiresAt: number; // unix seconds
  verifyingContract?: Address; // AtlasIdentityRegistry, when deployed
}

export const LOGIN_TYPES = {
  AtlasLogin: [
    { name: "purpose", type: "string" },
    { name: "statement", type: "string" },
    { name: "audience", type: "string" },
    { name: "wallet", type: "address" },
    { name: "loginId", type: "string" },
    { name: "nonce", type: "bytes32" },
    { name: "issuedAt", type: "uint256" },
    { name: "expiresAt", type: "uint256" },
  ],
} as const;

export function randomNonce(): Hex {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return toHex(b);
}

export function newChallenge(args: { wallet: Address; audience: string; chainId: number; verifyingContract?: Address; now?: number; ttl?: number }): LoginChallenge {
  const now = args.now ?? Math.floor(Date.now() / 1000);
  return {
    loginId: crypto.randomUUID(),
    wallet: getAddress(args.wallet),
    nonce: randomNonce(),
    audience: args.audience,
    chainId: args.chainId,
    issuedAt: now,
    expiresAt: now + (args.ttl ?? CHALLENGE_TTL_SECONDS),
    verifyingContract: args.verifyingContract,
  };
}

export function loginTypedData(c: LoginChallenge) {
  return {
    domain: {
      name: "ATLAS Social",
      version: "1",
      chainId: c.chainId,
      ...(c.verifyingContract ? { verifyingContract: c.verifyingContract } : {}),
    },
    types: LOGIN_TYPES,
    primaryType: "AtlasLogin" as const,
    message: {
      purpose: LOGIN_PURPOSE,
      statement: LOGIN_STATEMENT,
      audience: c.audience,
      wallet: c.wallet,
      loginId: c.loginId,
      nonce: c.nonce,
      issuedAt: BigInt(c.issuedAt),
      expiresAt: BigInt(c.expiresAt),
    },
  };
}

/** eth_signTypedData_v4 JSON (domain + EIP712Domain types) as required by `baw sign-message --message`. */
export function typedDataJson(c: LoginChallenge): string {
  const td = loginTypedData(c);
  const domainType = [
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "chainId", type: "uint256" },
    ...(c.verifyingContract ? [{ name: "verifyingContract", type: "address" }] : []),
  ];
  return JSON.stringify({
    domain: td.domain,
    types: { EIP712Domain: domainType, ...td.types },
    primaryType: td.primaryType,
    message: { ...td.message, issuedAt: String(c.issuedAt), expiresAt: String(c.expiresAt) },
  });
}

/** On-chain fallback: commitment submitted to AtlasIdentityRegistry.registerIdentity. */
export function identityCommitment(c: Pick<LoginChallenge, "chainId" | "wallet" | "loginId" | "nonce">, registry: Address): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "string" }, { type: "uint256" }, { type: "address" }, { type: "address" }, { type: "string" }, { type: "bytes32" }],
      ["ATLAS_LOGIN_V1", BigInt(c.chainId), registry, c.wallet, c.loginId, c.nonce],
    ),
  );
}

/**
 * Accepts: 65-byte 0x{r}{s}{v}; 64-byte {r}{s} with a separate recovery id ("00"/"01"/"1b"/"1c"), as
 * returned by `baw sign-message execute|result` (`signature` + `signatureRecovery`); with or without 0x.
 * Returns candidate 65-byte signatures (two when the recovery id is unknown).
 */
export function normalizeSignature(signature: string, recovery?: string | number | null): Hex[] {
  const s = signature.trim().replace(/^0x/i, "").toLowerCase();
  if (!/^[0-9a-f]+$/.test(s)) throw new SignatureFormatError("signature must be hex");
  if (s.length === 130) return [`0x${s}`];
  if (s.length !== 128) throw new SignatureFormatError(`unexpected signature length ${s.length / 2} bytes`);
  if (recovery === undefined || recovery === null || recovery === "") return [`0x${s}1b`, `0x${s}1c`];
  let v = typeof recovery === "number" ? recovery : parseInt(String(recovery).replace(/^0x/i, ""), 16);
  if (Number.isNaN(v)) throw new SignatureFormatError("bad recovery id");
  if (v < 27) v += 27;
  if (v !== 27 && v !== 28) throw new SignatureFormatError("bad recovery id");
  return [`0x${s}${v.toString(16)}`];
}

export class SignatureFormatError extends Error {}

export type VerifyFailure =
  | "EXPIRED"
  | "ALREADY_USED"
  | "WALLET_MISMATCH"
  | "AUDIENCE_MISMATCH"
  | "CHAIN_MISMATCH"
  | "BAD_SIGNATURE"
  | "MALFORMED_SIGNATURE";

export interface StoredChallenge extends LoginChallenge {
  usedAt?: number | null;
}

/**
 * Verifies a submitted signature against the SERVER-STORED challenge (never against client-provided
 * typed data). Supports EOAs via ecrecover and smart-contract wallets via ERC-1271/6492 when a public
 * client is supplied (viem's publicClient.verifyTypedData).
 */
export async function verifyLoginSignature(args: {
  challenge: StoredChallenge;
  signature: string;
  recovery?: string | number | null;
  expected: { audience: string; chainId: number };
  client?: Pick<PublicClient, "verifyTypedData">;
  now?: number;
}): Promise<{ ok: true; wallet: Address; method: "ecrecover" | "erc1271" } | { ok: false; reason: VerifyFailure }> {
  const c = args.challenge;
  const now = args.now ?? Math.floor(Date.now() / 1000);
  if (c.usedAt) return { ok: false, reason: "ALREADY_USED" };
  if (now > c.expiresAt) return { ok: false, reason: "EXPIRED" };
  if (c.audience !== args.expected.audience) return { ok: false, reason: "AUDIENCE_MISMATCH" };
  if (c.chainId !== args.expected.chainId) return { ok: false, reason: "CHAIN_MISMATCH" };

  let candidates: Hex[] = [];
  try {
    candidates = normalizeSignature(args.signature, args.recovery);
  } catch {
    // Contract-wallet (ERC-1271/6492) signatures can have any length; only meaningful with a client.
    if (!args.client || !/^(0x)?[0-9a-fA-F]+$/.test(args.signature.trim())) return { ok: false, reason: "MALFORMED_SIGNATURE" };
  }
  const td = loginTypedData(c);
  for (const sig of candidates) {
    try {
      const rec = await recoverTypedDataAddress({ ...td, signature: sig });
      if (isAddressEqual(rec, c.wallet)) return { ok: true, wallet: c.wallet, method: "ecrecover" };
    } catch {
      /* try next */
    }
  }
  if (args.client) {
    // ERC-1271 / ERC-6492 contract wallets (raw signature, not the 65-byte candidates)
    const raw = (args.signature.startsWith("0x") ? args.signature : `0x${args.signature}`) as Hex;
    for (const sig of [raw, ...candidates]) {
      try {
        if (await args.client.verifyTypedData({ address: c.wallet, ...td, signature: sig })) {
          return { ok: true, wallet: c.wallet, method: "erc1271" };
        }
      } catch {
        /* continue */
      }
    }
  }
  return { ok: false, reason: "BAD_SIGNATURE" };
}
