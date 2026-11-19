import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { getAddress, parseUnits, formatEther, toHex, type Address, type Hex } from "viem";
import { CHAIN_META, explorerAddress } from "@atlas/shared-types";
import { AtlasPayAbi } from "@atlas/shared-types/abi";
import { agentTokenId } from "@atlas/agent-id";
import { planPayment, assertSafePaySteps, payContextRef, payMemoHash, PayError, ERC20_ABI, PAY_KINDS, PAY_CONTEXT_KINDS, type UnsignedTx } from "@atlas/wallet-integration";
import { bawContractCallCommand } from "@atlas/auth";
import {
  bawResolveCommand, BAW_ADDRESS_BOOK_WARNING, BAW_BROADCAST_NOTE, BAW_FALLBACK_WARNING, BAW_CONTRACT_WARNING, BAW_NATIVE_TOKEN, BSC_USDT, isPayAmount,
} from "@atlas/auth/pay";
import type { Deps } from "../deps.js";
import { ApiError, bad, conflict, forbidden, notFound } from "../lib/errors.js";
import { requireAuth, requireCsrf, securityEvent } from "../lib/session.js";
import { createIntent } from "../lib/connect.js";
import { walletOf } from "../lib/views.js";
import { assertPayDeployed, PAY_PENDING_MESSAGE, PAY_ASSETS, receiptView, requestView, assetDecimals } from "../lib/pay.js";

const uuid = z.string().uuid();
const amount = z.string().max(40).refine(isPayAmount, "amount must be a positive decimal with at most 18 decimals");
const contextSchema = z.object({ kind: z.enum(PAY_CONTEXT_KINDS), id: uuid.optional() });
/** Anti-enumeration: distinct recipients a sender may resolve per 24h (the send flow is not a lookup tool). */
export const MAX_DISTINCT_RECIPIENTS_PER_DAY = 25;

export const PAY_NOTICE =
  "ATLAS prepares unsigned transactions only. It never signs, never holds funds and never asks for credentials. Payments are voluntary, final once confirmed on-chain, and never affect Skill Score, Arena rank, points, levels or achievements.";

const recipientSelect = `SELECT p.user_id, p.agent_name, p.display_name, p.avatar_url, l.handle, l.token_id, coalesce(ps.accept_payments, true) AS accept_payments
  FROM profiles p JOIN users u ON u.id = p.user_id AND u.status = 'active'
  JOIN agent_id_links l ON l.user_id = p.user_id AND l.revoked_at IS NULL
  LEFT JOIN privacy_settings ps ON ps.user_id = p.user_id`;

export async function payRoutes(app: FastifyInstance, deps: Deps) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const c = deps.contracts;
  const chainHex = toHex(c.chainId);

  // Checked once: the configured AtlasPay must be pinned to this chain's registry and stable token.
  let verified: Promise<void> | null = null;
  const verifyPayContract = () => {
    if (deps.mockResolver) return Promise.resolve(); // dev/test only (mock mode is refused in production)
    verified ??= (async () => {
      const [agentId, stable] = await Promise.all([
        deps.chain.readContract({ address: c.pay, abi: AtlasPayAbi, functionName: "agentId" }) as Promise<Address>,
        deps.chain.readContract({ address: c.pay, abi: AtlasPayAbi, functionName: "stableToken" }) as Promise<Address>,
      ]);
      if (getAddress(agentId) !== c.agentId || getAddress(stable) !== c.stable) throw new Error("AtlasPay is not pinned to the configured registry / token");
    })().catch((e) => { verified = null; throw new ApiError(503, "PAY_MISCONFIGURED", `AtlasPay could not be verified: ${(e as Error).message.slice(0, 120)}`); });
    return verified;
  };

  async function recipientRow(userId: string) {
    const [row] = await deps.db.sys(`${recipientSelect} WHERE p.user_id = $1`, [userId]);
    if (!row) throw notFound("Recipient");
    return row;
  }

  async function senderWallet(userId: string) {
    const w = await walletOf(deps.db.sys, userId);
    if (!w) throw forbidden("NO_AGENT_ID", "Payments are sent from a linked Agent ID wallet");
    return getAddress(w);
  }

  async function assertCanPay(senderId: string, rcpt: any) {
    if (rcpt.user_id === senderId) throw bad("SELF_PAYMENT", "You cannot pay yourself");
    if (!rcpt.accept_payments) throw forbidden("PAYMENTS_DISABLED", "This account does not accept payments");
    const blocked = await deps.db.sys(`SELECT 1 FROM blocks WHERE (user_id = $1 AND blocked_id = $2) OR (user_id = $2 AND blocked_id = $1)`, [rcpt.user_id, senderId]);
    if (blocked.length) throw forbidden("BLOCKED", "You cannot pay this account");
  }

  /** Validates the linked context so a tip can only go to the author of THAT post/thesis, a DM to a member, etc. */
  async function checkContext(senderId: string, recipientId: string, ctx: { kind: string; id?: string }, kind: string, asset: string, amt: string) {
    if (ctx.kind !== "profile" && !ctx.id) throw bad("CONTEXT_REQUIRED", "Context id required");
    if ((kind === "tip") !== (ctx.kind === "post" || ctx.kind === "thesis")) throw bad("BAD_CONTEXT", "Tips are for posts and theses; other payments use profile, DM or request context");
    if ((kind === "request") !== (ctx.kind === "request")) throw bad("BAD_CONTEXT", "Request payments must reference the request");
    if (ctx.kind === "post") {
      const [p] = await deps.db.sys(`SELECT author_id FROM posts WHERE id = $1 AND deleted_at IS NULL AND moderation_status <> 'removed'`, [ctx.id]);
      if (!p) throw notFound("Post");
      if (p.author_id !== recipientId) throw bad("BAD_CONTEXT", "A tip goes to the post's author");
    } else if (ctx.kind === "thesis") {
      const [t] = await deps.db.sys(`SELECT author_id FROM theses WHERE id = $1 AND chain_status IN ('committed','published')`, [ctx.id]);
      if (!t) throw notFound("Thesis");
      if (t.author_id !== recipientId) throw bad("BAD_CONTEXT", "A tip goes to the thesis author");
    } else if (ctx.kind === "dm") {
      const m = await deps.db.sys(`SELECT user_id FROM conversation_members WHERE conversation_id = $1 AND user_id = ANY($2::uuid[])`, [ctx.id, [senderId, recipientId]]);
      if (m.length !== 2) throw forbidden("NOT_MEMBER", "Both people must be in this conversation");
    } else if (ctx.kind === "request") {
      const [q] = await deps.db.sys(`SELECT * FROM payment_requests WHERE id = $1`, [ctx.id]);
      if (!q) throw notFound("Request");
      if (q.requester_id !== recipientId) throw bad("BAD_CONTEXT", "This request was made by someone else");
      if (q.payer_id && q.payer_id !== senderId) throw forbidden("NOT_PAYER", "This request is addressed to another account");
      if (q.status !== "open" || new Date(q.expires_at).getTime() < deps.now() * 1000) throw conflict("REQUEST_CLOSED", `This request is ${q.status === "open" ? "expired" : q.status}`);
      if (q.asset !== asset || q.amount !== amt) throw bad("REQUEST_MISMATCH", `This request is for ${q.amount} ${q.asset}`);
    } else if (ctx.id && ctx.id !== recipientId) throw bad("BAD_CONTEXT", "Profile context must be the recipient");
  }

  // ---------------------------------------------------------------- public status
  r.get("/pay/config", { schema: { tags: ["pay"], summary: "ATLAS Pay deployment status (honest pending state) and supported assets" } }, async () => ({
    chainId: c.chainId,
    chain: CHAIN_META[c.chainId]?.name,
    status: c.payDeployed ? "deployed" : "pending",
    contract: c.payDeployed ? c.pay : null,
    contractExplorer: c.payDeployed ? explorerAddress(c.chainId, c.pay) : null,
    agentIdRegistry: c.agentId,
    assets: [
      { symbol: "BNB", native: true, decimals: 18, address: null, bawTokenAddress: BAW_NATIVE_TOKEN },
      { symbol: "USDT", native: false, decimals: 18, address: c.stable === "0x0000000000000000000000000000000000000000" ? (c.chainId === 56 ? BSC_USDT : null) : c.stable, isMock: c.stableIsMock, bawTokenAddress: BSC_USDT },
    ],
    pendingMessage: c.payDeployed ? null : PAY_PENDING_MESSAGE,
    fallback: { kind: "baw", available: true, docs: "https://github.com/binance/binance-skills-hub/blob/main/skills/binance-web3/binance-agentic-wallet/references/send.md" },
    notice: PAY_NOTICE,
    reputation: "Payments and tips never change Skill Score, Arena rank, points, levels or achievements.",
  }));

  // ---------------------------------------------------------------- send flow: resolve ONE recipient
  r.post("/pay/recipient", {
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    schema: { tags: ["pay"], summary: "Inside a send flow only: the CURRENT owner address of one recipient profile's Agent ID (fresh on-chain read, rate-limited, logged; not a lookup tool)", body: z.object({ recipientUserId: uuid }) },
  }, async (req) => {
    const a = requireCsrf(req);
    const from = await senderWallet(a.userId);
    const rcpt = await recipientRow(req.body.recipientUserId);
    await assertCanPay(a.userId, rcpt);
    const [{ n }] = await deps.db.sys(`SELECT count(DISTINCT detail->>'recipientId')::int AS n FROM security_events WHERE user_id = $1 AND kind = 'pay_resolve' AND created_at > now() - interval '24 hours' AND detail->>'recipientId' <> $2`, [a.userId, rcpt.user_id]);
    if (n >= MAX_DISTINCT_RECIPIENTS_PER_DAY) throw new ApiError(429, "RESOLVE_LIMIT", "Daily limit of distinct payment recipients reached. ATLAS Pay is not a wallet lookup tool.", { retryAfterSeconds: 3600 });
    const owner = await deps.payRecipients.currentOwner(rcpt.handle);
    await securityEvent(deps, a.userId, "pay_resolve", { recipientId: rcpt.user_id, found: !!owner });
    if (!owner) throw conflict("RECIPIENT_NOT_FOUND", `${rcpt.agent_name} has no current owner on the Agent ID registry. Payment is blocked.`);
    const tokenId = agentTokenId(rcpt.handle);
    // viem returns undefined for an EOA; null here means the read failed (shown as UNKNOWN, never guessed)
    const code = deps.mockResolver ? undefined : await deps.chain.getCode({ address: owner }).catch(() => null);
    return {
      recipient: { userId: rcpt.user_id, agentName: rcpt.agent_name, displayName: rcpt.display_name, avatarUrl: rcpt.avatar_url },
      address: getAddress(owner),
      addressType: code === null ? "UNKNOWN" : code && code !== "0x" ? "CONTRACT" : "EOA",
      tokenId: tokenId.toString(),
      network: { chainId: c.chainId, name: CHAIN_META[c.chainId]?.name },
      resolvedAt: new Date(deps.now() * 1000).toISOString(),
      sender: from,
      source: "Agent ID registry ownerOf(keccak256(handle)) — read now, not cached",
      note: "AtlasPay re-resolves this Agent ID when your transaction executes and reverts if the owner is no longer this address.",
    };
  });

  // ---------------------------------------------------------------- prepare unsigned transactions
  r.post("/pay/prepare", {
    config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    schema: {
      tags: ["pay"], summary: "Unsigned AtlasPay transaction(s) for the sender's own wallet to preview and authorize",
      body: z.object({ recipientUserId: uuid, expectedRecipient: z.string().regex(/^0x[0-9a-fA-F]{40}$/), asset: z.enum(PAY_ASSETS), amount, kind: z.enum(PAY_KINDS), context: contextSchema, memo: z.string().max(140).default("") }),
    },
  }, async (req) => prepareUnsigned(requireCsrf(req), req.body));

  type PrepareBody = { recipientUserId: string; expectedRecipient: string; asset: (typeof PAY_ASSETS)[number]; amount: string; kind: (typeof PAY_KINDS)[number]; context: { kind: (typeof PAY_CONTEXT_KINDS)[number]; id?: string }; memo: string };
  /** Shared by the human send sheet and the Agent Gateway: validates, re-reads the owner, plans exact-amount unsigned steps. */
  async function prepareUnsigned(a: { userId: string }, b: PrepareBody) {
    assertPayDeployed(deps);
    const from = await senderWallet(a.userId);
    const rcpt = await recipientRow(b.recipientUserId);
    await assertCanPay(a.userId, rcpt);
    await checkContext(a.userId, rcpt.user_id, b.context, b.kind, b.asset, b.amount);
    await verifyPayContract();
    const owner = await deps.payRecipients.currentOwner(rcpt.handle);
    if (!owner) throw conflict("RECIPIENT_NOT_FOUND", `${rcpt.agent_name} has no current owner on the Agent ID registry`);
    if (getAddress(owner) !== getAddress(b.expectedRecipient)) throw new ApiError(409, "RECIPIENT_CHANGED", "The Agent ID owner changed since you reviewed it. Review the new address before continuing.", { current: getAddress(owner) });
    const amountWei = parseUnits(b.amount, assetDecimals(b.asset));
    const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
    const contextRef = payContextRef(b.context.kind, b.context.id ?? rcpt.user_id, salt);
    const memoHash = payMemoHash(b.memo);
    const allowance = b.asset === "USDT"
      ? await (deps.chain.readContract({ address: c.stable, abi: ERC20_ABI, functionName: "allowance", args: [from, c.pay] }) as Promise<bigint>).catch(() => 0n)
      : undefined;
    let steps: UnsignedTx[];
    try {
      steps = planPayment({ chainId: c.chainId, from, pay: c.pay, stable: c.stable, asset: b.asset, amountWei, recipientTokenId: agentTokenId(rcpt.handle), expectedRecipient: getAddress(owner), kind: b.kind, contextRef, memoHash, allowance });
      assertSafePaySteps(steps, { from, pay: c.pay, stable: c.stable, amountWei, asset: b.asset });
    } catch (e) {
      if (e instanceof PayError) throw bad("PAY_REJECTED", e.message);
      throw e;
    }
    // gas: real estimates where the chain can simulate; an approve-gated payToken can only be estimated after approval
    const gasPrice = deps.mockResolver ? null : await deps.chain.getGasPrice().catch(() => null);
    const FALLBACK_GAS: Record<string, bigint> = { approve: 60_000n, payToken: 110_000n, payNative: 90_000n };
    const gas = await Promise.all(steps.map(async (s) => {
      const name = s.data.startsWith("0x095ea7b3") ? "approve" : s.to === c.pay && BigInt(s.value) > 0n ? "payNative" : "payToken";
      if (deps.mockResolver) return { step: name, gas: FALLBACK_GAS[name]!.toString(), estimated: false };
      try { return { step: name, gas: (await deps.chain.estimateGas({ account: from, to: s.to, data: s.data as Hex, value: BigInt(s.value) })).toString(), estimated: true }; } catch (e) {
        return { step: name, gas: FALLBACK_GAS[name]!.toString(), estimated: false, reason: (e as Error).message.split("\n")[0]!.slice(0, 140) };
      }
    }));
    const totalGas = gas.reduce((t, g) => t + BigInt(g.gas), 0n);
    const [intent] = await deps.db.as(a.userId, (q) => q(
      `INSERT INTO payment_intents (sender_id, recipient_id, chain_id, pay_contract, asset, amount_wei, kind, context_kind, context_id, request_id, context_ref, memo, memo_hash, expected_recipient, recipient_token_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id, created_at`,
      [a.userId, rcpt.user_id, c.chainId, c.pay.toLowerCase(), b.asset, amountWei.toString(), b.kind, b.context.kind, b.context.id ?? null, b.context.kind === "request" ? b.context.id : null, contextRef.toLowerCase(), b.memo, memoHash.toLowerCase(), owner.toLowerCase(), agentTokenId(rcpt.handle).toString()],
    ));
    return {
      intentId: intent.id,
      network: { chainId: c.chainId, name: CHAIN_META[c.chainId]?.name },
      recipient: { userId: rcpt.user_id, agentName: rcpt.agent_name, displayName: rcpt.display_name, address: getAddress(owner), tokenId: agentTokenId(rcpt.handle).toString() },
      asset: b.asset, amount: b.amount, amountWei: amountWei.toString(), kind: b.kind,
      contextRef, memoHash,
      payContract: c.pay,
      stableIsMock: b.asset === "USDT" && c.stableIsMock,
      steps: steps.map((s, i) => ({ ...s, gas: gas[i], baw: bawContractCallCommand({ chainId: s.chainId, from: s.from, to: s.to, data: s.data as Hex, value: BigInt(s.value) }), eip1193: { from: s.from, to: s.to, data: s.data, value: toHex(BigInt(s.value)), chainId: chainHex } })),
      gasEstimate: { gas: totalGas.toString(), gasPriceWei: gasPrice?.toString() ?? null, feeBnb: gasPrice ? formatEther(totalGas * gasPrice) : null, estimated: gas.every((g) => g.estimated), note: gas.every((g) => g.estimated) ? "Estimated by simulating against the chain now; your wallet shows the final fee." : "Approximate: some steps can only be simulated after the previous one confirms. Your wallet shows the final fee." },
      notice: PAY_NOTICE,
      receipt: "A receipt appears in Pay → Receipts only after the PaymentSent event is indexed from the chain (provisional, then final).",
    };
  }

  // ---------------------------------------------------------------- baw fallback (official flow)
  r.post("/pay/fallback", {
    config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    schema: { tags: ["pay"], summary: "Official Binance Agentic Wallet fallback: resolve-domain first, confirm, then send", body: z.object({ recipientUserId: uuid, asset: z.enum(PAY_ASSETS), amount }) },
  }, async (req) => {
    const a = requireCsrf(req);
    await senderWallet(a.userId);
    const rcpt = await recipientRow(req.body.recipientUserId);
    await assertCanPay(a.userId, rcpt);
    return fallbackFor(rcpt, req.body.asset, req.body.amount);
  });

  // ---------------------------------------------------------------- ATLAS Connect payment handoff
  r.post("/pay/handoff", {
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    schema: {
      tags: ["pay", "connect"],
      summary: "Prepare a payment and hand it to the sender's own Agentic Wallet via ATLAS Connect (browser-bound code). ATLAS never signs or holds a wallet session.",
      body: z.object({ recipientUserId: uuid, expectedRecipient: z.string().regex(/^0x[0-9a-fA-F]{40}$/), asset: z.enum(PAY_ASSETS), amount, kind: z.enum(PAY_KINDS), context: contextSchema, memo: z.string().max(140).default("") }),
    },
  }, async (req, reply) => {
    const a = requireCsrf(req);
    const b = req.body;
    const from = await senderWallet(a.userId);
    let payload: Record<string, unknown>;
    if (c.payDeployed) {
      const p = await prepareUnsigned(a, b);
      payload = {
        mode: "contract-call", paymentIntentId: p.intentId, from, network: p.network, recipient: p.recipient, asset: p.asset, amount: p.amount, amountWei: p.amountWei,
        kind: p.kind, payContract: p.payContract, gasEstimate: p.gasEstimate, stableIsMock: p.stableIsMock,
        steps: p.steps.map((s) => ({ title: s.description, to: s.to, data: s.data, value: s.value, chainId: s.chainId, baw: s.baw })),
        knownIssue: { issue: "https://github.com/binance/binance-skills-hub/issues/375", note: "baw contract-call preview can fail on some view-call simulations; if it does, stop and use the fallback. ATLAS offers no bypass." },
      };
    } else {
      // AtlasPay pending: the official baw flow (resolve-domain, confirm, address book, send) with ATLAS's own read of the owner to compare
      const rcpt = await recipientRow(b.recipientUserId);
      await assertCanPay(a.userId, rcpt);
      const owner = await deps.payRecipients.currentOwner(rcpt.handle);
      if (!owner) throw conflict("RECIPIENT_NOT_FOUND", `${rcpt.agent_name} has no current owner on the Agent ID registry`);
      if (getAddress(owner) !== getAddress(b.expectedRecipient)) throw new ApiError(409, "RECIPIENT_CHANGED", "The Agent ID owner changed since you reviewed it.", { current: getAddress(owner) });
      payload = {
        mode: "fallback", from, network: { chainId: 56, name: "BNB Smart Chain" },
        recipient: { userId: rcpt.user_id, agentName: rcpt.agent_name, displayName: rcpt.display_name, address: getAddress(owner) },
        expectedRecipient: getAddress(owner), asset: b.asset, amount: b.amount, amountWei: parseUnits(b.amount, assetDecimals(b.asset)).toString(),
        tokenAddress: b.asset === "BNB" ? BAW_NATIVE_TOKEN : BSC_USDT,
        fallback: fallbackFor(rcpt, b.asset, b.amount),
        addressBook: BAW_ADDRESS_BOOK_WARNING,
      };
    }
    const intent = await createIntent(deps, req, reply, { purpose: "pay", userId: a.userId, sessionId: a.sessionId, payload });
    await securityEvent(deps, a.userId, "pay.handoff_created", { intentId: intent.intentId, mode: payload.mode });
    return { ...intent, payment: payload, notice: PAY_NOTICE };
  });

  function fallbackFor(rcpt: any, asset: (typeof PAY_ASSETS)[number], amount: string) {
    const req = { body: { asset, amount } };
    return {
      recipient: { userId: rcpt.user_id, agentName: rcpt.agent_name, displayName: rcpt.display_name },
      asset: req.body.asset, amount: req.body.amount,
      tokenAddress: req.body.asset === "BNB" ? BAW_NATIVE_TOKEN : BSC_USDT,
      steps: [
        { id: "resolve", title: "Resolve the Agent ID in your own wallet", command: bawResolveCommand(rcpt.agent_name), note: "Paste the JSON output back. If it errors, payment is blocked — do not retry with a different name or chain." },
        { id: "confirm", title: "Check the full resolved address and every warning, then confirm in a separate step", note: BAW_ADDRESS_BOOK_WARNING },
        { id: "send", title: "Send to the resolved address (never the name)", template: `baw wallet send --amount ${req.body.amount} --recipient <resolved address> --binanceChainId 56 --tokenAddress ${req.body.asset === "BNB" ? BAW_NATIVE_TOKEN : BSC_USDT} --json`, note: BAW_BROADCAST_NOTE },
      ],
      warnings: { fallback: BAW_FALLBACK_WARNING, contract: BAW_CONTRACT_WARNING, addressBook: BAW_ADDRESS_BOOK_WARNING },
      difference: "baw resolves the name through Binance's resolver records; AtlasPay pays the current Agent ID NFT owner. They are usually the same wallet but can differ. Compare against the address ATLAS shows before you confirm.",
      receiptNote: "A baw transfer is a plain transfer, so it does not create an ATLAS receipt. Track it with `baw wallet tx-history --json`.",
      docs: ["https://github.com/binance/binance-skills-hub/blob/main/skills/binance-web3/binance-agentic-wallet/references/domain-resolve.md", "https://github.com/binance/binance-skills-hub/blob/main/skills/binance-web3/binance-agentic-wallet/references/send.md"],
    };
  }

  // ---------------------------------------------------------------- Agent Gateway: prepare for ONE named profile
  r.post("/pay/agent/prepare", {
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    schema: {
      tags: ["pay", "agents"],
      summary: "For agents (pay:prepare): resolve ONE named recipient inside this prepare and return UNSIGNED steps (or the official baw fallback while AtlasPay is pending). Never signs or sends.",
      body: z.object({ recipient: z.string().min(3).max(80), asset: z.enum(PAY_ASSETS), amount, kind: z.enum(["direct", "tip"]).default("direct"), context: contextSchema.default({ kind: "profile" }), memo: z.string().max(140).default("") }),
    },
  }, async (req) => {
    const a = requireCsrf(req);
    const b = req.body;
    if (b.context.kind === "dm" || b.context.kind === "request") throw bad("BAD_CONTEXT", "Agents can prepare direct payments and tips only");
    // exact Agent ID name only (e.g. alice.ai): there is no search, listing or partial match
    const name = b.recipient.trim().toLowerCase();
    const [row] = await deps.db.sys(`${recipientSelect} WHERE lower(p.agent_name) = $1`, [name]);
    if (!row) throw notFound("Recipient");
    await senderWallet(a.userId);
    await assertCanPay(a.userId, row);
    if (!c.payDeployed) {
      return { status: "pending", message: PAY_PENDING_MESSAGE, fallback: fallbackFor(row, b.asset, b.amount), operatorAction: "The operator runs these baw commands themselves; Binance Agentic Wallet shows its own confirmation. ATLAS cannot complete or verify a baw transfer as an ATLAS receipt." };
    }
    const [{ n }] = await deps.db.sys(`SELECT count(DISTINCT detail->>'recipientId')::int AS n FROM security_events WHERE user_id = $1 AND kind = 'pay_resolve' AND created_at > now() - interval '24 hours' AND detail->>'recipientId' <> $2`, [a.userId, row.user_id]);
    if (n >= MAX_DISTINCT_RECIPIENTS_PER_DAY) throw new ApiError(429, "RESOLVE_LIMIT", "Daily limit of distinct payment recipients reached. ATLAS Pay is not a wallet lookup tool.", { retryAfterSeconds: 3600 });
    const owner = await deps.payRecipients.currentOwner(row.handle);
    await securityEvent(deps, a.userId, "pay_resolve", { recipientId: row.user_id, found: !!owner, via: "agent", agentTokenId: req.agent?.tokenId ?? null });
    if (!owner) throw conflict("RECIPIENT_NOT_FOUND", `${row.agent_name} has no current owner on the Agent ID registry. Payment is blocked.`);
    const prepared = await prepareUnsigned(a, { recipientUserId: row.user_id, expectedRecipient: getAddress(owner), asset: b.asset, amount: b.amount, kind: b.kind, context: b.context, memo: b.memo });
    return { status: "prepared", ...prepared, operatorAction: "Unsigned only. The operator must review the full recipient address and confirm each step in their own wallet (Binance Agentic Wallet: baw contract-call preview, then execute after its confirmation). The agent cannot sign or send." };
  });

  // ---------------------------------------------------------------- receipts (indexed from chain)
  const receiptSql = `SELECT x.*, i.context_kind, i.context_id, i.request_id, i.memo,
      ps.agent_name AS sender_agent_name, ps.display_name AS sender_display_name, pr.agent_name AS recipient_agent_name, pr.display_name AS recipient_display_name
    FROM payments x LEFT JOIN payment_intents i ON i.id = x.intent_id
    LEFT JOIN profiles ps ON ps.user_id = x.sender_id LEFT JOIN profiles pr ON pr.user_id = x.recipient_id`;

  r.get("/pay/receipts", { schema: { tags: ["pay"], querystring: z.object({ direction: z.enum(["all", "sent", "received"]).default("all"), limit: z.coerce.number().int().min(1).max(100).default(50) }) } }, async (req) => {
    const a = requireAuth(req);
    const dir = req.query.direction;
    const where = dir === "sent" ? "x.sender_id = $1" : dir === "received" ? "x.recipient_id = $1" : "(x.sender_id = $1 OR x.recipient_id = $1)";
    const rows = await deps.db.as(a.userId, (q) => q(`${receiptSql} WHERE ${where} ORDER BY x.block_number DESC, x.event_id DESC LIMIT $2`, [a.userId, req.query.limit]));
    return { items: rows.map((x) => receiptView(x, a.userId)), status: c.payDeployed ? "deployed" : "pending", notice: "Receipts are read from AtlasPay PaymentSent events on-chain. Provisional receipts become final after confirmations; a chain reorg can remove a provisional one." };
  });

  r.get("/pay/receipts/:id", { schema: { tags: ["pay"], params: z.object({ id: z.string().max(140) }) } }, async (req) => {
    const a = requireAuth(req);
    const [x] = await deps.db.as(a.userId, (q) => q(`${receiptSql} WHERE x.event_id = $1`, [req.params.id]));
    if (!x) throw notFound("Receipt");
    return receiptView(x, a.userId);
  });

  // ---------------------------------------------------------------- payment requests
  const requestSql = `SELECT q.*, p.agent_name AS requester_agent_name, p.display_name AS requester_display_name, p.avatar_url AS requester_avatar_url FROM payment_requests q JOIN profiles p ON p.user_id = q.requester_id`;

  r.post("/pay/requests", {
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    schema: { tags: ["pay"], summary: "Create a shareable payment request (the payer authorizes it independently in their own wallet)", body: z.object({ asset: z.enum(PAY_ASSETS), amount, note: z.string().max(140).default(""), payerUserId: uuid.optional(), context: z.object({ kind: z.enum(["link", "post", "dm"]), id: uuid.optional() }).default({ kind: "link" }), expiresInHours: z.number().int().min(1).max(720).default(168) }) },
  }, async (req) => {
    const a = requireCsrf(req);
    await senderWallet(a.userId);
    const b = req.body;
    let payer = b.payerUserId ?? null;
    if (payer === a.userId) throw bad("SELF_PAYMENT", "You cannot request a payment from yourself");
    if (b.context.kind !== "link" && !b.context.id) throw bad("CONTEXT_REQUIRED", "Context id required");
    if (b.context.kind === "post") {
      const [p] = await deps.db.sys(`SELECT author_id FROM posts WHERE id = $1 AND deleted_at IS NULL`, [b.context.id]);
      if (!p || p.author_id !== a.userId) throw forbidden("NOT_AUTHOR", "Attach requests only to your own posts");
    }
    if (b.context.kind === "dm") {
      const ms = await deps.db.sys(`SELECT user_id FROM conversation_members WHERE conversation_id = $1`, [b.context.id]);
      if (!ms.some((m: any) => m.user_id === a.userId)) throw forbidden("NOT_MEMBER", "Not a member of this conversation");
      const others = ms.filter((m: any) => m.user_id !== a.userId).map((m: any) => m.user_id);
      if (payer && !others.includes(payer)) throw bad("BAD_PAYER", "The payer must be in this conversation");
      if (!payer && others.length === 1) payer = others[0];
    }
    if (b.context.kind !== "dm" && b.context.kind !== "link" && b.context.kind !== "post") throw bad("BAD_CONTEXT", "Unsupported context");
    const wei = parseUnits(b.amount, assetDecimals(b.asset));
    const [row] = await deps.db.as(a.userId, (q) => q(
      `INSERT INTO payment_requests (requester_id, payer_id, asset, amount, amount_wei, note, context_kind, context_id, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now() + make_interval(hours => $9)) RETURNING id`,
      [a.userId, payer, b.asset, b.amount, wei.toString(), b.note, b.context.kind, b.context.id ?? null, b.expiresInHours],
    ));
    const [full] = await deps.db.sys(`${requestSql} WHERE q.id = $1`, [row.id]);
    return { ...requestView(full, deps), shareUrl: `${deps.cfg.PUBLIC_ORIGIN}/pay/r/${row.id}`, contractsPending: !c.payDeployed };
  });

  r.get("/pay/requests", { schema: { tags: ["pay"] } }, async (req) => {
    const a = requireAuth(req);
    const rows = await deps.db.as(a.userId, (q) => q(`${requestSql} WHERE q.requester_id = $1 OR q.payer_id = $1 ORDER BY q.created_at DESC LIMIT 100`, [a.userId]));
    return { items: rows.map((x) => requestView(x, deps)) };
  });

  r.get("/pay/requests/:id", { schema: { tags: ["pay"], params: z.object({ id: uuid }) } }, async (req) => {
    const me = req.auth?.userId ?? null;
    const [x] = await deps.db.sys(`${requestSql} WHERE q.id = $1`, [req.params.id]);
    if (!x) throw notFound("Request");
    let visible = x.context_kind !== "dm" || x.requester_id === me || x.payer_id === me;
    if (!visible && me) visible = (await deps.db.sys(`SELECT 1 FROM conversation_members WHERE conversation_id = $1 AND user_id = $2`, [x.context_id, me])).length > 0;
    if (!visible) throw notFound("Request");
    const v = requestView(x, deps);
    return { ...v, viewer: { isRequester: x.requester_id === me, canPay: !!me && x.requester_id !== me && (!x.payer_id || x.payer_id === me) && v.status === "open" }, contractsPending: !c.payDeployed, notice: PAY_NOTICE };
  });

  r.post("/pay/requests/:id/cancel", { schema: { tags: ["pay"], params: z.object({ id: uuid }) } }, async (req) => {
    const a = requireCsrf(req);
    const rows = await deps.db.as(a.userId, (q) => q(`UPDATE payment_requests SET status = 'cancelled' WHERE id = $1 AND requester_id = $2 AND status = 'open' RETURNING id`, [req.params.id, a.userId]));
    if (!rows.length) throw notFound("Open request");
    return { ok: true };
  });

  // privacy: opt out of receiving payments
  r.put("/pay/settings", { schema: { tags: ["pay"], body: z.object({ acceptPayments: z.boolean() }) } }, async (req) => {
    const a = requireCsrf(req);
    await deps.db.as(a.userId, (q) => q(`INSERT INTO privacy_settings (user_id, accept_payments) VALUES ($1,$2) ON CONFLICT (user_id) DO UPDATE SET accept_payments = EXCLUDED.accept_payments, updated_at = now()`, [a.userId, req.body.acceptPayments]));
    return { acceptPayments: req.body.acceptPayments };
  });
  r.get("/pay/settings", { schema: { tags: ["pay"] } }, async (req) => {
    const a = requireAuth(req);
    const [s] = await deps.db.as(a.userId, (q) => q(`SELECT accept_payments FROM privacy_settings WHERE user_id = $1`, [a.userId]));
    return { acceptPayments: s?.accept_payments ?? true };
  });
}
