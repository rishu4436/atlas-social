/**
 * ATLAS Connect: "Continue with Binance Agentic Wallet".
 *
 * Browser routes (cookie-bound):   POST /auth/connect/intents, GET /auth/connect/intents/:id,
 *                                  POST /auth/connect/intents/:id/redeem, POST /auth/connect/intents/:id/cancel
 * Handoff routes (public code):    POST /auth/connect/handoff/open | challenge | report | complete | tx
 *
 * The handoff can never start a session: only the browser holding the verifier cookie can redeem, once.
 */
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { decodeFunctionData, getAddress, isAddress, parseAbi, type Address, type Hex } from "viem";
import { CONNECT_MAX_PROOF_ATTEMPTS, CONNECT_STAGES, bawSignInCommands, type LoginChallenge } from "@atlas/auth";
import type { Deps } from "../deps.js";
import { requireCsrf, startSession, securityEvent } from "../lib/session.js";
import { assertOpen, connectErr, cookieName, createIntent, intentByCode, intentForBrowser, viewIntent } from "../lib/connect.js";
import { authErr, consumeChallenge, issueChallenge, linkOrCreateAccount } from "./auth.js";
import { STEP_UP_TTL_SECONDS } from "@atlas/auth";

const walletSchema = z.string().refine((s) => isAddress(s, { strict: false }), "invalid address").transform((s) => getAddress(s));
const codeSchema = z.string().min(4).max(64);
const ERC20 = parseAbi(["function transfer(address to, uint256 amount) returns (bool)"]);

export async function connectRoutes(app: FastifyInstance, deps: Deps) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  // per-IP route limits (the test suite creates many intents from one IP, so it scales them up)
  const k = deps.cfg.NODE_ENV === "test" ? 100 : 1;
  const createLimit = { config: { rateLimit: { max: 10 * k, timeWindow: "1 minute" } } };
  const handoffLimit = { config: { rateLimit: { max: 30 * k, timeWindow: "1 minute" } } };
  const pollLimit = { config: { rateLimit: { max: 120 * k, timeWindow: "1 minute" } } };

  // ------------------------------------------------------------------ browser
  r.post("/auth/connect/intents", {
    ...createLimit,
    schema: {
      tags: ["auth", "connect"], summary: "Start ATLAS Connect in this browser (Continue with Binance Agentic Wallet)",
      description: "Returns a public connection code for the handoff and sets an httpOnly browser-binding cookie. purpose=step-up refreshes 'Agentic Wallet available' for the signed-in session.",
      body: z.object({ purpose: z.enum(["login", "step-up"]).default("login") }).default({ purpose: "login" }),
    },
  }, async (req, reply) => {
    if (req.body.purpose === "step-up") {
      const a = requireCsrf(req);
      const [link] = await deps.db.sys(`SELECT wallet_address FROM agent_id_links WHERE user_id = $1 AND revoked_at IS NULL`, [a.userId]);
      if (!link) throw connectErr(403, "NO_AGENT_ID", "No active Agent ID on this account");
      return createIntent(deps, req, reply, { purpose: "step-up", userId: a.userId, sessionId: a.sessionId });
    }
    return createIntent(deps, req, reply, { purpose: "login" });
  });

  r.get("/auth/connect/intents/:id", {
    ...pollLimit,
    schema: { tags: ["auth", "connect"], summary: "Poll a connection (browser-bound)", params: z.object({ id: z.string().uuid() }) },
  }, async (req) => viewIntent(deps, await intentForBrowser(deps, req, req.params.id)));

  r.post("/auth/connect/intents/:id/cancel", {
    schema: { tags: ["auth", "connect"], params: z.object({ id: z.string().uuid() }) },
  }, async (req, reply) => {
    const row = await intentForBrowser(deps, req, req.params.id);
    await deps.db.sys(`UPDATE connect_intents SET status = 'cancelled' WHERE id = $1 AND status IN ('pending','challenge_issued','approved')`, [row.id]);
    if (row.login_id) await deps.db.sys(`UPDATE login_challenges SET used_at = now() WHERE id = $1 AND used_at IS NULL`, [row.login_id]);
    reply.clearCookie(cookieName(row.purpose), { path: "/" });
    return { ok: true };
  });

  r.post("/auth/connect/intents/:id/redeem", {
    ...createLimit,
    schema: {
      tags: ["auth", "connect"], summary: "Redeem an approved connection in the browser that created it (one time)",
      description: "confirmAgentName must equal the Agent ID the handoff proved, so a leaked code cannot silently sign this browser into someone else's account.",
      params: z.object({ id: z.string().uuid() }), body: z.object({ confirmAgentName: z.string().min(3).max(80) }),
    },
  }, async (req, reply) => {
    const row = await intentForBrowser(deps, req, req.params.id);
    if (row.purpose === "pay") throw connectErr(400, "CONNECT_WRONG_STATE", "Payment handoffs are not redeemed; they are verified on chain.");
    assertOpen(row, ["approved"]);
    if (String(row.agent_name).toLowerCase() !== req.body.confirmAgentName.trim().toLowerCase()) {
      throw connectErr(409, "CONNECT_AGENT_MISMATCH", "The Agent ID you confirmed is not the one that signed. Cancel and start again if this is not you.", { proven: row.agent_name });
    }
    if (row.purpose === "step-up" && !req.auth) throw connectErr(401, "UNAUTHENTICATED", "Sign in first");
    if (row.purpose === "step-up") requireCsrf(req);
    // one-time: atomic transition approved -> redeemed (a replayed redeem finds no row)
    const [won] = await deps.db.sys(
      `UPDATE connect_intents SET status = 'redeemed', redeemed_at = to_timestamp($2)
        WHERE id = $1 AND status = 'approved' AND expires_at > to_timestamp($2) RETURNING id`,
      [row.id, deps.now()],
    );
    if (!won) throw connectErr(409, "CONNECT_ALREADY_USED", "This connection was already used. Each code works once.");
    reply.clearCookie(cookieName(row.purpose), { path: "/" });
    const wallet = getAddress(row.wallet) as Address;
    if (row.purpose === "step-up") {
      await deps.db.sys(`UPDATE sessions SET wallet_verified_at = to_timestamp($2), wallet_check_source = 'connect-step-up' WHERE id = $1`, [row.session_id, deps.now()]);
      await securityEvent(deps, row.user_id, "step-up.connect", { intentId: row.id });
      return { ok: true, purpose: "step-up", freshUntil: deps.now() + STEP_UP_TTL_SECONDS };
    }
    const { userId, isNew, agentName } = await linkOrCreateAccount(deps, wallet, row.payload?.linkMethod ?? "eip712", row.token_id);
    const s = await startSession(deps, req, reply, { userId, method: "wallet", walletVerified: true, walletCheckSource: "connect" });
    await securityEvent(deps, userId, isNew ? "account.created" : "login.wallet", { method: row.payload?.linkMethod, via: "atlas-connect", intentId: row.id, wallet: wallet.toLowerCase() });
    return { ok: true, purpose: "login", userId, agentName, isNew, csrfToken: s.csrfToken, next: isNew ? "/welcome/profile" : "/home" };
  });

  // ------------------------------------------------------------------ handoff (holder of the public code)
  r.post("/auth/connect/handoff/open", {
    ...handoffLimit,
    schema: { tags: ["connect"], summary: "Handoff: what this connection code asks for (no account data)", body: z.object({ code: codeSchema }) },
  }, async (req) => {
    const row = await intentByCode(deps, req.body.code);
    assertOpen(row, ["pending", "challenge_issued", "approved", "submitted"]);
    if (!row.stage) await deps.db.sys(`UPDATE connect_intents SET stage = 'handoff_started' WHERE id = $1 AND stage IS NULL`, [row.id]);
    const base = { purpose: row.purpose, status: row.status, expiresAt: Math.floor(new Date(row.expires_at).getTime() / 1000), serverNow: deps.now(), site: deps.cfg.PUBLIC_ORIGIN };
    if (row.purpose === "pay") return { ...base, payment: row.payload, steps: payHandoffSteps(row.payload) };
    return {
      ...base,
      operation: "Sign the ATLAS Social EIP-712 login message (primaryType AtlasLogin). It grants no token approvals and moves no funds.",
      steps: [
        "baw wallet status --json  → must be CONNECTED (sign in with `baw auth signin` yourself if not)",
        "baw wallet address --json → take the BSC (binanceChainId 56) address",
        "baw wallet agent-id --json → must show claimed: true",
        "POST /auth/connect/handoff/challenge {code, wallet} → typed data + exact baw commands",
        "baw sign-message preview … → show parsed message + risks to the user",
        "Only after the user says yes: baw sign-message execute --requestId … (then sign-message result --order-id … if it waits for the Binance app)",
        "POST /auth/connect/handoff/complete {code, loginId, signature, recovery}",
      ],
      knownIssue: { code: "953004", issue: "https://github.com/binance/binance-skills-hub/issues/400", note: "If preview fails with 953004, report stage=failed with bawCode 953004; the browser offers the on-chain fallback." },
    };
  });

  r.post("/auth/connect/handoff/report", {
    ...handoffLimit,
    schema: {
      tags: ["connect"], summary: "Handoff: report progress so the browser can show it (enumerated stages only)",
      body: z.object({ code: codeSchema, stage: z.enum(CONNECT_STAGES), bawCode: z.string().regex(/^\d{3,9}$/).optional(), errorCode: z.string().regex(/^[A-Z0-9_]{2,40}$/).optional() }),
    },
  }, async (req) => {
    const row = await intentByCode(deps, req.body.code);
    assertOpen(row, ["pending", "challenge_issued", "approved", "submitted"]);
    const detail = req.body.bawCode || req.body.errorCode ? { bawCode: req.body.bawCode, errorCode: req.body.errorCode } : null;
    await deps.db.sys(`UPDATE connect_intents SET stage = $2, stage_detail = $3 WHERE id = $1`, [row.id, req.body.stage, detail]);
    return { ok: true };
  });

  r.post("/auth/connect/handoff/challenge", {
    ...handoffLimit,
    schema: {
      tags: ["connect"], summary: "Handoff: get the ATLAS EIP-712 challenge for this connection and the exact baw commands",
      body: z.object({ code: codeSchema, wallet: walletSchema }),
    },
  }, async (req) => {
    const row = await intentByCode(deps, req.body.code);
    if (row.purpose === "pay") throw connectErr(400, "CONNECT_WRONG_STATE", "Payment handoffs have no login challenge.");
    assertOpen(row, ["pending", "challenge_issued"]);
    const wallet = req.body.wallet as Address;
    if (row.purpose === "step-up") {
      const [link] = await deps.db.sys(`SELECT wallet_address FROM agent_id_links WHERE user_id = $1 AND revoked_at IS NULL`, [row.user_id]);
      if (!link || link.wallet_address !== wallet.toLowerCase()) {
        await deps.db.sys(`UPDATE connect_intents SET stage = 'failed', stage_detail = '{"errorCode":"WALLET_MISMATCH"}' WHERE id = $1`, [row.id]);
        throw authErr(403, "WALLET_MISMATCH");
      }
    }
    const id = await deps.resolver.resolve(wallet, { fresh: true });
    if (!id.eligible) {
      await deps.db.sys(`UPDATE connect_intents SET stage = 'failed', stage_detail = '{"errorCode":"NOT_AGENT_ID_HOLDER"}' WHERE id = $1`, [row.id]);
      throw authErr(403, "NOT_AGENT_ID_HOLDER");
    }
    const issued = await issueChallenge(deps, wallet, "connect", row.user_id ?? null);
    // only the latest challenge for this connection is valid
    if (row.login_id) {
      await deps.db.sys(`UPDATE login_challenges SET used_at = now(), payload = payload || jsonb_build_object('supersededBy', $2::text) WHERE id = $1 AND used_at IS NULL`, [row.login_id, issued.loginId]);
    }
    const upd = await deps.db.sys(
      `UPDATE connect_intents SET status = 'challenge_issued', login_id = $2, stage = 'wallet_checked', stage_detail = NULL,
              payload = payload || jsonb_build_object('claimed', jsonb_build_object('wallet', $3::text, 'agentName', $4::text))
        WHERE id = $1 AND status IN ('pending','challenge_issued') RETURNING id`,
      [row.id, issued.loginId, wallet, id.agentName],
    );
    if (!upd.length) throw connectErr(409, "CONNECT_WRONG_STATE", "This connection changed state; start again.");
    const challenge = (await deps.db.sys(`SELECT payload FROM login_challenges WHERE id = $1`, [issued.loginId]))[0].payload as LoginChallenge;
    const baw = bawSignInCommands(challenge);
    return {
      loginId: issued.loginId, agentName: id.agentName, wallet, chainId: issued.chainId,
      expiresAt: Math.min(issued.expiresAt, Math.floor(new Date(row.expires_at).getTime() / 1000)), serverNow: deps.now(),
      typedData: issued.typedData,
      signRequest: baw.message,
      baw: { checkDevMode: baw.checkDevMode, preview: baw.preview, previewByShell: baw.previewByShell, execute: baw.execute, result: baw.result },
      instructions: "Run preview, show the user the parsed message and every risk, and execute only after explicit approval. Then POST /auth/connect/handoff/complete.",
    };
  });

  r.post("/auth/connect/handoff/complete", {
    ...handoffLimit,
    schema: {
      tags: ["connect"], summary: "Handoff: submit the signature. ATLAS verifies it (ECDSA or ERC-1271) and Agent ID NFT ownership; does NOT create a session",
      body: z.object({ code: codeSchema, loginId: z.string().uuid(), signature: z.string().max(4000), recovery: z.union([z.string().max(4), z.number()]).optional() }),
    },
  }, async (req) => {
    const row = await intentByCode(deps, req.body.code);
    if (row.purpose === "pay") throw connectErr(400, "CONNECT_WRONG_STATE", "Payment handoffs submit transactions, not signatures.");
    assertOpen(row, ["challenge_issued"]);
    if (row.login_id !== req.body.loginId) throw authErr(400, "CHALLENGE_CONTEXT_MISMATCH");
    const [{ attempts }] = await deps.db.sys(`UPDATE connect_intents SET attempts = attempts + 1 WHERE id = $1 RETURNING attempts`, [row.id]);
    const fail = async (code: string) => {
      const dead = attempts >= CONNECT_MAX_PROOF_ATTEMPTS;
      await deps.db.sys(`UPDATE connect_intents SET status = $2, stage = 'failed', stage_detail = jsonb_build_object('errorCode', $3::text) WHERE id = $1 AND status = 'challenge_issued'`, [row.id, dead ? "failed" : "pending", code]);
    };
    let proven: Awaited<ReturnType<typeof consumeChallenge>>;
    try {
      proven = await consumeChallenge(deps, { loginId: req.body.loginId, mode: "signature", signature: req.body.signature, recovery: req.body.recovery }, "connect", row.user_id ?? null);
    } catch (e: any) {
      await fail(e?.code ?? "SIGNATURE_REJECTED");
      throw e;
    }
    // independent on-chain check: the proven wallet must own the Agent ID NFT right now (and the same token for step-up)
    const id = await deps.resolver.resolve(proven.wallet, { fresh: true });
    if (!id.eligible || id.tokenId === null) { await fail("NOT_AGENT_ID_HOLDER"); throw authErr(403, "NOT_AGENT_ID_HOLDER"); }
    if (row.purpose === "step-up") {
      const [link] = await deps.db.sys(`SELECT token_id FROM agent_id_links WHERE user_id = $1 AND revoked_at IS NULL`, [row.user_id]);
      if (!link || link.token_id !== id.tokenId.toString()) { await fail("AGENT_ID_NOT_HELD"); throw connectErr(403, "AGENT_ID_NOT_HELD", "This wallet no longer holds the linked Agent ID"); }
    }
    const upd = await deps.db.sys(
      `UPDATE connect_intents SET status = 'approved', stage = 'signed', stage_detail = NULL, wallet = $2, agent_name = $3, token_id = $4, proof_method = $5,
              approved_at = to_timestamp($6), payload = payload || jsonb_build_object('linkMethod', $7::text)
        WHERE id = $1 AND status = 'challenge_issued' AND login_id = $8 RETURNING id`,
      [row.id, proven.wallet.toLowerCase(), id.agentName, id.tokenId.toString(), proven.verifiedBy === "erc1271" ? "erc1271" : "signature", deps.now(), proven.method, req.body.loginId],
    );
    if (!upd.length) throw connectErr(409, "CONNECT_ALREADY_USED", "This connection was already completed.");
    await securityEvent(deps, row.user_id ?? null, "connect.approved", { intentId: row.id, purpose: row.purpose, method: proven.method, wallet: proven.wallet.toLowerCase() });
    return { ok: true, status: "approved", agentName: id.agentName, next: "Return to the browser that showed this code and confirm there. This code cannot sign anyone in anywhere else." };
  });

  r.post("/auth/connect/handoff/tx", {
    ...handoffLimit,
    schema: {
      tags: ["connect", "pay"], summary: "Handoff: report the tx hash of a payment step; ATLAS verifies it on chain against the prepared step",
      body: z.object({ code: codeSchema, step: z.number().int().min(0).max(4), txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/) }),
    },
  }, async (req) => {
    const row = await intentByCode(deps, req.body.code);
    if (row.purpose !== "pay") throw connectErr(400, "CONNECT_WRONG_STATE", "Only payment handoffs take transactions.");
    assertOpen(row, ["pending", "submitted"]);
    const p = row.payload;
    const hash = req.body.txHash.toLowerCase() as Hex;
    const [dup] = await deps.db.sys(`SELECT id FROM connect_intents WHERE result->'txHashes' ? $1 AND id <> $2 LIMIT 1`, [hash, row.id]);
    if (dup) throw connectErr(409, "TX_ALREADY_REPORTED", "That transaction belongs to another payment.");
    const tx = await deps.chain.getTransaction({ hash }).catch(() => null);
    if (!tx) throw connectErr(409, "TX_NOT_FOUND", "Transaction not found on chain yet. Retry in a few seconds.");
    const from = String(p.from).toLowerCase();
    if (tx.from.toLowerCase() !== from) throw connectErr(400, "TX_MISMATCH", "Transaction was not sent from your verified wallet.");
    if (p.mode === "contract-call") {
      const s = p.steps?.[req.body.step];
      if (!s) throw connectErr(400, "TX_MISMATCH", "Unknown step");
      const ok = tx.to?.toLowerCase() === String(s.to).toLowerCase() && tx.input.toLowerCase() === String(s.data).toLowerCase() && tx.value === BigInt(s.value);
      if (!ok) throw connectErr(400, "TX_MISMATCH", "Transaction does not match the prepared ATLAS Pay step (to, data or value differ).");
    } else {
      const expected = String(p.expectedRecipient).toLowerCase();
      const amountWei = BigInt(p.amountWei);
      let ok = false;
      if (p.asset === "BNB") ok = tx.to?.toLowerCase() === expected && tx.value === amountWei;
      else {
        try {
          const d = decodeFunctionData({ abi: ERC20, data: tx.input });
          ok = tx.to?.toLowerCase() === String(p.tokenAddress).toLowerCase() && d.functionName === "transfer" && String(d.args[0]).toLowerCase() === expected && d.args[1] === amountWei;
        } catch { ok = false; }
      }
      if (!ok) throw connectErr(400, "TX_MISMATCH", "Transaction is not a transfer of the reviewed amount to the reviewed address.");
    }
    const receipt = await deps.chain.getTransactionReceipt({ hash }).catch(() => null);
    if (receipt?.status === "reverted") {
      await deps.db.sys(`UPDATE connect_intents SET stage = 'failed', stage_detail = '{"errorCode":"TX_REVERTED"}' WHERE id = $1`, [row.id]);
      throw connectErr(409, "TX_REVERTED", "The transaction matched the reviewed step but reverted on chain. No payment was made.");
    }
    const hashes: (string | null)[] = [...(row.result?.txHashes ?? [])];
    hashes[req.body.step] = hash;
    const need = p.mode === "contract-call" ? p.steps.length : 1;
    const done = hashes.filter(Boolean).length >= need;
    await deps.db.sys(`UPDATE connect_intents SET result = $2, status = $3, stage = 'broadcast', stage_detail = NULL WHERE id = $1`, [row.id, { txHashes: hashes }, done ? "submitted" : row.status]);
    await securityEvent(deps, row.user_id, "pay.handoff_tx", { intentId: row.id, step: req.body.step, txHash: hash });
    return { ok: true, verified: true, step: req.body.step, complete: done, mined: !!receipt, note: "Verified against the reviewed step. The receipt appears only after the PaymentSent event is indexed from the chain." };
  });
}

/** Steps the handoff runs for a payment: contract-call preview → user approval → execute, or the official baw fallback. */
export function payHandoffSteps(p: any) {
  if (p.mode === "contract-call") {
    return (p.steps ?? []).map((s: any, i: number) => ({
      step: i, title: s.title ?? `Step ${i + 1}`, preview: s.baw.preview, execute: s.baw.execute,
      rule: "Show parsedTx, simulation, risks and authorityChanges. Execute only after the user approves. If preview is intercepted, stop.",
    }));
  }
  return (p.fallback?.steps ?? []).map((s: any, i: number) => ({ step: i, title: s.title, command: s.command ?? s.template, note: s.note }));
}
