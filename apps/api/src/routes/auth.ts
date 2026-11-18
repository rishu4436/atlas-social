import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { getAddress, isAddress, type Address, type Hex } from "viem";
import {
  newChallenge, loginTypedData, typedDataJson, identityCommitment, verifyLoginSignature, bawSignInCommands, bawContractCallCommand,
  SESSION_COOKIE, hashToken, authLevel, LOGIN_STATEMENT,
} from "@atlas/auth";
import { atlasCalls } from "@atlas/wallet-integration";
import { AtlasIdentityRegistryAbi } from "@atlas/shared-types";
import {
  generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type { Deps } from "../deps.js";
import { ApiError, bad, conflict, forbidden, notFound } from "../lib/errors.js";
import { requireAuth, requireCsrf, requireFreshWallet, startSession, clearSessionCookies, securityEvent } from "../lib/session.js";

const walletSchema = z.string().refine((s) => isAddress(s, { strict: false }), "invalid address").transform((s) => getAddress(s));

function rp(deps: Deps) {
  const origin = new URL(deps.cfg.PUBLIC_ORIGIN);
  return { rpID: deps.cfg.RP_ID ?? origin.hostname, rpName: deps.cfg.RP_NAME, origins: [deps.cfg.PUBLIC_ORIGIN, ...deps.cfg.WEB_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean)] };
}

async function issueChallenge(deps: Deps, wallet: Address, purpose: "login" | "step-up", userId: string | null) {
  const c = newChallenge({ wallet, audience: deps.cfg.PUBLIC_ORIGIN, chainId: deps.contracts.chainId, verifyingContract: deps.contracts.identity, now: deps.now() });
  await deps.db.sys(
    `INSERT INTO login_challenges (id, wallet, nonce, chain_id, audience, purpose, user_id, issued_at, expires_at, payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7,to_timestamp($8),to_timestamp($9),$10)`,
    [c.loginId, wallet.toLowerCase(), c.nonce, c.chainId, c.audience, purpose, userId, c.issuedAt, c.expiresAt, c],
  );
  const commitment = identityCommitment(c, deps.contracts.identity);
  const tx = atlasCalls.registerIdentity(c.chainId, wallet, deps.contracts.identity, commitment);
  return {
    loginId: c.loginId,
    expiresAt: c.expiresAt,
    statement: LOGIN_STATEMENT,
    typedData: JSON.parse(typedDataJson(c)),
    wallet: { baw: bawSignInCommands(c) },
    onchainFallback: {
      commitment,
      transaction: tx,
      baw: bawContractCallCommand({ chainId: c.chainId, from: wallet, to: deps.contracts.identity, data: tx.data as Hex }),
      note: "If your wallet cannot sign typed data, prove ownership by calling AtlasIdentityRegistry.registerIdentity(commitment) from the same wallet (no value, no approvals), then submit with mode=onchain.",
    },
  };
}

/** Verifies the proof for a stored challenge and consumes it atomically. Returns the proven wallet. */
async function consumeChallenge(deps: Deps, body: { loginId: string; mode: "signature" | "onchain"; signature?: string; recovery?: string | number }, purpose: "login" | "step-up", userId: string | null) {
  const [row] = await deps.db.sys(`SELECT * FROM login_challenges WHERE id = $1 AND purpose = $2`, [body.loginId, purpose]);
  if (!row) throw new ApiError(400, "CHALLENGE_NOT_FOUND", "Unknown or mismatched login challenge");
  if (purpose === "step-up" && row.user_id !== userId) throw new ApiError(400, "CHALLENGE_CONTEXT_MISMATCH", "Challenge belongs to another session");
  const c = { ...row.payload, usedAt: row.used_at ? 1 : null };
  if (c.usedAt) throw new ApiError(400, "ALREADY_USED", "This challenge was already used. Request a new one.");
  if (deps.now() > c.expiresAt) throw new ApiError(400, "EXPIRED", "This challenge expired. Request a new one.");
  let method: "eip712" | "erc1271" | "onchain" | "mock";
  if (body.mode === "onchain") {
    const commitment = identityCommitment(c, deps.contracts.identity);
    const usedBy = (await deps.chain.readContract({ address: deps.contracts.identity, abi: AtlasIdentityRegistryAbi, functionName: "commitmentUsedBy", args: [commitment] })) as Address;
    if (usedBy === "0x0000000000000000000000000000000000000000") throw new ApiError(409, "PROOF_PENDING", "Identity proof transaction not found yet. Wait for confirmation and retry.");
    if (usedBy.toLowerCase() !== row.wallet) throw new ApiError(400, "WALLET_MISMATCH", "The on-chain proof was sent from a different wallet");
    method = "onchain";
  } else {
    if (!body.signature) throw bad("SIGNATURE_REQUIRED", "signature is required");
    const r = await verifyLoginSignature({ challenge: c, signature: body.signature, recovery: body.recovery, expected: { audience: deps.cfg.PUBLIC_ORIGIN, chainId: deps.contracts.chainId }, client: deps.chain, now: deps.now() });
    if (!r.ok) {
      await deps.db.sys(`UPDATE login_challenges SET used_at = now() WHERE id = $1 AND used_at IS NULL`, [row.id]); // failed attempts burn the challenge
      await securityEvent(deps, userId, "login.signature_rejected", { reason: r.reason, wallet: row.wallet });
      throw new ApiError(400, r.reason, "Signature rejected");
    }
    method = r.method === "erc1271" ? "erc1271" : "eip712";
  }
  const used = await deps.db.sys(`UPDATE login_challenges SET used_at = now() WHERE id = $1 AND used_at IS NULL RETURNING id`, [row.id]);
  if (!used.length) throw new ApiError(400, "ALREADY_USED", "This challenge was already used.");
  return { wallet: getAddress(row.wallet), method: deps.cfg.AGENT_ID_MODE === "mock" && method !== "onchain" ? ("mock" as const) : method };
}

export async function authRoutes(app: FastifyInstance, deps: Deps) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const loginLimit = { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } };

  r.post("/auth/challenge", { ...loginLimit, schema: { tags: ["auth"], summary: "Issue an ATLAS EIP-712 login challenge for an Agent ID wallet", body: z.object({ wallet: walletSchema }) } }, async (req) => {
    const id = await deps.resolver.resolve(req.body.wallet, { fresh: true });
    if (!id.eligible) throw forbidden("NOT_AGENT_ID_HOLDER", "This wallet does not hold an Agent ID. ATLAS accounts require an Agent ID.");
    return { ...(await issueChallenge(deps, req.body.wallet, "login", null)), agentName: id.agentName };
  });

  const verifyBody = z.object({
    loginId: z.string().uuid(),
    mode: z.enum(["signature", "onchain"]).default("signature"),
    signature: z.string().max(4000).optional(),
    recovery: z.union([z.string().max(4), z.number()]).optional(),
  });

  r.post("/auth/verify", { ...loginLimit, schema: { tags: ["auth"], summary: "Verify a signed challenge (or on-chain proof) and start a session", body: verifyBody } }, async (req, reply) => {
    const { wallet, method } = await consumeChallenge(deps, req.body, "login", null);
    const id = await deps.resolver.resolve(wallet, { fresh: true });
    if (!id.eligible || id.tokenId === null) throw forbidden("NOT_AGENT_ID_HOLDER", "Agent ID ownership could not be confirmed");
    const contract = deps.contracts.agentId.toLowerCase();
    const w = wallet.toLowerCase();
    let isNew = false;
    let userId: string;
    try {
      userId = await deps.db.sysTx(async (q) => {
        const [byToken] = await q(`SELECT * FROM agent_id_links WHERE chain_id = $1 AND agent_contract = $2 AND token_id = $3 FOR UPDATE`, [deps.contracts.chainId, contract, id.tokenId!.toString()]);
        if (byToken) {
          if (byToken.revoked_at) throw conflict("AGENT_ID_REVOKED", "This Agent ID association was revoked. Contact support to re-verify.");
          if (byToken.wallet_address !== w) throw conflict("WALLET_CHANGED", "This Agent ID is linked to a different wallet. The verified wallet cannot be silently replaced.");
          await q(`UPDATE agent_id_links SET verified_at = now() WHERE id = $1`, [byToken.id]);
          return byToken.user_id as string;
        }
        const [byWallet] = await q(`SELECT * FROM agent_id_links WHERE chain_id = $1 AND wallet_address = $2 AND revoked_at IS NULL`, [deps.contracts.chainId, w]);
        if (byWallet) throw conflict("IDENTITY_MISMATCH", "This wallet is linked to a different Agent ID.");
        const [u] = await q(`INSERT INTO users DEFAULT VALUES RETURNING id`);
        await q(`INSERT INTO agent_id_links (user_id, chain_id, agent_contract, token_id, handle, wallet_address, method) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [u.id, deps.contracts.chainId, contract, id.tokenId!.toString(), id.handle, w, method]);
        await q(`INSERT INTO profiles (user_id, agent_name, display_name) VALUES ($1,$2,$3)`, [u.id, id.agentName, id.handle]);
        await q(`INSERT INTO privacy_settings (user_id) VALUES ($1)`, [u.id]);
        await q(`INSERT INTO notification_prefs (user_id) VALUES ($1)`, [u.id]);
        isNew = true;
        return u.id as string;
      });
    } catch (e: any) {
      if (e?.code === "23505") throw conflict("AGENT_ID_ALREADY_REGISTERED", "This Agent ID or wallet already belongs to an ATLAS account.");
      throw e;
    }
    const [user] = await deps.db.sys(`SELECT status FROM users WHERE id = $1`, [userId]);
    if (user.status !== "active") throw forbidden("ACCOUNT_SUSPENDED", "This account is suspended");
    const s = await startSession(deps, req, reply, { userId, method: "wallet", walletVerified: true });
    await securityEvent(deps, userId, isNew ? "account.created" : "login.wallet", { method, wallet: w });
    return { userId, agentName: id.agentName, isNew, csrfToken: s.csrfToken, method };
  });

  r.post("/auth/step-up/challenge", { schema: { tags: ["auth"], summary: "Fresh wallet proof for financial or high-risk actions" } }, async (req) => {
    const a = requireCsrf(req);
    const [link] = await deps.db.sys(`SELECT wallet_address FROM agent_id_links WHERE user_id = $1 AND revoked_at IS NULL`, [a.userId]);
    if (!link) throw forbidden("NO_AGENT_ID", "No active Agent ID on this account");
    return issueChallenge(deps, getAddress(link.wallet_address), "step-up", a.userId);
  });

  r.post("/auth/step-up/verify", { schema: { tags: ["auth"], body: verifyBody } }, async (req) => {
    const a = requireCsrf(req);
    const { wallet } = await consumeChallenge(deps, req.body, "step-up", a.userId);
    const id = await deps.resolver.resolve(wallet, { fresh: true });
    const [link] = await deps.db.sys(`SELECT token_id FROM agent_id_links WHERE user_id = $1 AND revoked_at IS NULL`, [a.userId]);
    if (!id.eligible || !link || link.token_id !== id.tokenId?.toString()) throw forbidden("AGENT_ID_NOT_HELD", "This wallet no longer holds the linked Agent ID");
    await deps.db.sys(`UPDATE sessions SET wallet_verified_at = to_timestamp($2) WHERE id = $1`, [a.sessionId, deps.now()]);
    await securityEvent(deps, a.userId, "step-up.ok", {});
    return { ok: true, freshUntil: deps.now() + 600 };
  });

  r.get("/auth/session", { schema: { tags: ["auth"] } }, async (req) => {
    if (!req.auth) return { authenticated: false, level: "guest", reason: req.authError ?? null };
    const [p] = await deps.db.sys(
      `SELECT p.agent_name, p.display_name, p.avatar_url, l.wallet_address, l.handle, l.method, l.chain_id FROM profiles p JOIN agent_id_links l ON l.user_id = p.user_id AND l.revoked_at IS NULL WHERE p.user_id = $1`,
      [req.auth.userId],
    );
    const level = authLevel({ userId: req.auth.userId, createdAt: 0, lastSeenAt: deps.now(), expiresAt: deps.now() + 1, walletVerifiedAt: req.auth.walletVerifiedAt, method: "wallet-signature" }, deps.now());
    return {
      authenticated: true, level, userId: req.auth.userId, method: req.auth.method, roles: req.auth.roles,
      freshWalletUntil: req.auth.walletVerifiedAt ? req.auth.walletVerifiedAt + 600 : null,
      profile: p ? { agentName: p.agent_name, displayName: p.display_name, avatarUrl: p.avatar_url } : null,
      identity: p ? { wallet: getAddress(p.wallet_address), handle: p.handle, method: p.method, chainId: Number(p.chain_id) } : null,
    };
  });

  r.post("/auth/logout", { schema: { tags: ["auth"], body: z.object({ all: z.boolean().default(false) }).default({}) } }, async (req, reply) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (req.auth) {
      requireCsrf(req);
      if (req.body.all) await deps.db.sys(`UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [req.auth.userId]);
      else await deps.db.sys(`UPDATE sessions SET revoked_at = now() WHERE id = $1`, [req.auth.sessionId]);
      await securityEvent(deps, req.auth.userId, req.body.all ? "logout.all" : "logout", {});
    } else if (token) {
      await deps.db.sys(`UPDATE sessions SET revoked_at = now() WHERE token_hash = $1`, [hashToken(token)]);
    }
    clearSessionCookies(reply);
    return { ok: true };
  });

  r.get("/auth/sessions", { schema: { tags: ["auth"] } }, async (req) => {
    const a = requireAuth(req);
    const rows = await deps.db.as(a.userId, (q) => q(`SELECT id, auth_method, created_at, last_seen_at, user_agent, wallet_verified_at FROM sessions WHERE revoked_at IS NULL AND expires_at > now() ORDER BY last_seen_at DESC`));
    return rows.map((s) => ({ ...s, current: s.id === a.sessionId }));
  });

  r.delete("/auth/sessions/:id", { schema: { tags: ["auth"], params: z.object({ id: z.string().uuid() }) } }, async (req) => {
    const a = requireCsrf(req);
    const rows = await deps.db.as(a.userId, (q) => q(`UPDATE sessions SET revoked_at = now() WHERE id = $1 RETURNING id`, [req.params.id]));
    if (!rows.length) throw notFound("Session");
    return { ok: true };
  });

  // ---------------------------------------------------------------- passkeys (social access only)
  r.get("/auth/passkeys", { schema: { tags: ["auth"] } }, async (req) => {
    const a = requireAuth(req);
    return deps.db.as(a.userId, (q) => q(`SELECT id, name, created_at, last_used_at FROM passkeys ORDER BY created_at`));
  });

  r.post("/auth/passkeys/register/options", { schema: { tags: ["auth"], summary: "Register a passkey (requires fresh wallet proof)" } }, async (req) => {
    const a = requireFreshWallet(deps, req);
    const { rpID, rpName } = rp(deps);
    const [p] = await deps.db.sys(`SELECT agent_name FROM profiles WHERE user_id = $1`, [a.userId]);
    const existing = await deps.db.as(a.userId, (q) => q(`SELECT credential_id, transports FROM passkeys`));
    const opts = await generateRegistrationOptions({
      rpName, rpID, userName: p.agent_name, userID: new TextEncoder().encode(a.userId), attestationType: "none",
      excludeCredentials: existing.map((c) => ({ id: c.credential_id, transports: c.transports })),
      authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
    });
    await deps.db.sys(`INSERT INTO webauthn_challenges (user_id, kind, challenge, expires_at) VALUES ($1,'register',$2, now() + interval '5 minutes')`, [a.userId, opts.challenge]);
    return opts;
  });

  r.post("/auth/passkeys/register/verify", { schema: { tags: ["auth"], body: z.object({ response: z.any(), name: z.string().max(60).default("Passkey") }) } }, async (req) => {
    const a = requireFreshWallet(deps, req);
    const { rpID, origins } = rp(deps);
    const clientData = JSON.parse(Buffer.from(req.body.response?.response?.clientDataJSON ?? "", "base64url").toString() || "{}");
    const used = await deps.db.sys(`UPDATE webauthn_challenges SET used_at = now() WHERE challenge = $1 AND user_id = $2 AND kind = 'register' AND used_at IS NULL AND expires_at > now() RETURNING challenge`, [clientData.challenge, a.userId]);
    if (!used.length) throw bad("CHALLENGE_INVALID", "Passkey challenge invalid or expired");
    const v = await verifyRegistrationResponse({ response: req.body.response, expectedChallenge: used[0].challenge, expectedOrigin: origins, expectedRPID: rpID }).catch((e) => { throw bad("PASSKEY_REJECTED", e.message); });
    if (!v.verified || !v.registrationInfo) throw bad("PASSKEY_REJECTED", "Registration not verified");
    const cred = v.registrationInfo.credential;
    await deps.db.as(a.userId, (q) => q(`INSERT INTO passkeys (user_id, credential_id, public_key, counter, transports, name) VALUES ($1,$2,$3,$4,$5,$6)`,
      [a.userId, cred.id, Buffer.from(cred.publicKey), cred.counter, cred.transports ?? [], req.body.name]));
    await securityEvent(deps, a.userId, "passkey.registered", {});
    return { ok: true };
  });

  r.post("/auth/passkeys/login/options", { ...loginLimit, schema: { tags: ["auth"] } }, async () => {
    const { rpID } = rp(deps);
    const opts = await generateAuthenticationOptions({ rpID, userVerification: "preferred" });
    await deps.db.sys(`INSERT INTO webauthn_challenges (kind, challenge, expires_at) VALUES ('login',$1, now() + interval '5 minutes')`, [opts.challenge]);
    return opts;
  });

  r.post("/auth/passkeys/login/verify", { ...loginLimit, schema: { tags: ["auth"], body: z.object({ response: z.any() }) } }, async (req, reply) => {
    const { rpID, origins } = rp(deps);
    const resp = req.body.response;
    const clientData = JSON.parse(Buffer.from(resp?.response?.clientDataJSON ?? "", "base64url").toString() || "{}");
    const used = await deps.db.sys(`UPDATE webauthn_challenges SET used_at = now() WHERE challenge = $1 AND kind = 'login' AND used_at IS NULL AND expires_at > now() RETURNING challenge`, [clientData.challenge]);
    if (!used.length) throw bad("CHALLENGE_INVALID", "Passkey challenge invalid or expired");
    const [pk] = await deps.db.sys(`SELECT * FROM passkeys WHERE credential_id = $1`, [resp?.id]);
    if (!pk) throw bad("PASSKEY_UNKNOWN", "Unknown passkey");
    const v = await verifyAuthenticationResponse({
      response: resp, expectedChallenge: used[0].challenge, expectedOrigin: origins, expectedRPID: rpID,
      credential: { id: pk.credential_id, publicKey: new Uint8Array(pk.public_key), counter: Number(pk.counter), transports: pk.transports },
    }).catch((e) => { throw bad("PASSKEY_REJECTED", e.message); });
    if (!v.verified) throw bad("PASSKEY_REJECTED", "Passkey not verified");
    await deps.db.sys(`UPDATE passkeys SET counter = $2, last_used_at = now() WHERE id = $1`, [pk.id, v.authenticationInfo.newCounter]);
    const [u] = await deps.db.sys(`SELECT u.status FROM users u JOIN agent_id_links l ON l.user_id = u.id AND l.revoked_at IS NULL WHERE u.id = $1`, [pk.user_id]);
    if (!u || u.status !== "active") throw forbidden("ACCOUNT_UNAVAILABLE", "Account unavailable");
    const s = await startSession(deps, req, reply, { userId: pk.user_id, method: "passkey", walletVerified: false });
    await securityEvent(deps, pk.user_id, "login.passkey", {});
    return { userId: pk.user_id, csrfToken: s.csrfToken, method: "passkey", note: "Passkey sessions grant social access only. Financial or on-chain actions require a fresh wallet proof." };
  });

  r.delete("/auth/passkeys/:id", { schema: { tags: ["auth"], params: z.object({ id: z.string().uuid() }) } }, async (req) => {
    const a = requireFreshWallet(deps, req);
    const rows = await deps.db.as(a.userId, (q) => q(`DELETE FROM passkeys WHERE id = $1 RETURNING id`, [req.params.id]));
    if (!rows.length) throw notFound("Passkey");
    await securityEvent(deps, a.userId, "passkey.removed", {});
    return { ok: true };
  });

  void loginTypedData;
}
