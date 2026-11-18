import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { assertContractsDeployed } from "../lib/contracts-status.js";
import { z } from "zod";
import { decodeEventLog, getAddress, isAddressEqual, type Abi, type Address, type Hex } from "viem";
import {
  thesisDraftSchema, computeThesisCommitment, thesisContentHash, hashCanonical, marketByAsset, METHODOLOGY_M1, METHODOLOGY_M1_HASH,
  ReviewStance, EvidenceKind, AtlasThesisRegistryAbi, AtlasReviewRegistryAbi, explorerTx,
} from "@atlas/shared-types";
import { atlasCalls } from "@atlas/wallet-integration";
import { bawContractCallCommand } from "@atlas/auth";
import { evaluateWithProvider, verifyEvidence } from "@atlas/outcome-engine";
import type { Deps } from "../deps.js";
import { bad, forbidden, notFound, conflict, ApiError } from "../lib/errors.js";
import { requireCsrf } from "../lib/session.js";
import { thesisView, publicProfile, PROFILE_COLUMNS, walletOf } from "../lib/views.js";
import { buildTerms, termsToJson, termsFromJson, newCommitment, noteHash, applyChainEvent } from "../lib/theses.js";

const uuid = z.string().uuid();
const txHash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);

function wrapTx(deps: Deps, tx: { chainId: number; from: Address; to: Address; data: string; value: string; description: string }) {
  assertContractsDeployed(deps);
  return {
    transaction: tx,
    eip1193: { from: tx.from, to: tx.to, data: tx.data, value: "0x0", chainId: `0x${tx.chainId.toString(16)}` },
    baw: bawContractCallCommand({ chainId: tx.chainId, from: tx.from, to: tx.to, data: tx.data as Hex }),
    warning: "Review the wallet preview before confirming. ATLAS never signs or broadcasts for you. This call moves no funds and grants no approvals.",
    explorerHint: deps.contracts.chainId === 56 ? "https://bscscan.com" : null,
  };
}

async function loadThesis(deps: Deps, viewer: string | null, id: string) {
  const [t] = await deps.db.as(viewer, (q) => q(`SELECT * FROM theses WHERE id = $1`, [id]));
  if (!t) throw notFound("Thesis");
  return t;
}

/** Reads a receipt and returns decoded ATLAS events emitted by `registry` in it, after checking sender. */
async function receiptEvents(deps: Deps, hash: Hex, registry: Address, abi: Abi, expectedFrom: string) {
  const receipt = await deps.chain.getTransactionReceipt({ hash }).catch(() => null);
  if (!receipt) throw new ApiError(409, "TX_PENDING", "Transaction not found or not yet mined. Retry after confirmation.");
  if (receipt.status !== "success") throw bad("TX_FAILED", "Transaction reverted");
  if (!isAddressEqual(receipt.from, getAddress(expectedFrom))) throw forbidden("TX_NOT_FROM_AUTHOR", "Transaction was not sent by your linked Agent ID wallet");
  const block = await deps.chain.getBlock({ blockNumber: receipt.blockNumber });
  const events = receipt.logs.filter((l) => isAddressEqual(l.address, registry)).flatMap((l) => {
    try { const d = decodeEventLog({ abi, data: l.data, topics: l.topics }); return [{ name: String(d.eventName), args: d.args as any }]; } catch { return []; }
  });
  return { events, receipt, blockTime: block.timestamp };
}

export async function thesisRoutes(app: FastifyInstance, deps: Deps) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post("/theses", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } }, schema: { tags: ["theses"], summary: "Create a thesis draft (off-chain; private to the author until published)", body: thesisDraftSchema.extend({ squadId: uuid.optional() }) } }, async (req) => {
    const a = requireCsrf(req);
    const wallet = await walletOf(deps.db.sys, a.userId);
    if (!wallet) throw forbidden("NO_AGENT_ID", "No active Agent ID wallet");
    const m = marketByAsset(req.body.asset);
    if (!m) throw bad("UNSUPPORTED_ASSET", "Unsupported market");
    const price = await deps.market.ticker24h(m.symbol).then((t) => t.lastPrice).catch(() => null);
    const { terms, content } = buildTerms(req.body, deps.now(), price);
    const { salt, commitment } = newCommitment(deps, getAddress(wallet), terms);
    const [t] = await deps.db.as(a.userId, (q) => q(
      `INSERT INTO theses (author_id, author_wallet, chain_id, registry, asset, symbol, direction, entry_kind, entry_price, target_price, invalidation_price, horizon_hours, confidence, visibility, content, content_hash, terms, salt, commitment, squad_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING *`,
      [a.userId, wallet, deps.contracts.chainId, deps.contracts.thesis.toLowerCase(), m.asset, m.symbol, req.body.direction, req.body.entryKind, req.body.entryPrice ?? null, req.body.targetPrice, req.body.invalidationPrice,
        req.body.horizonHours, req.body.confidence, req.body.visibility, content, terms.contentHash, termsToJson(terms), salt, commitment, req.body.squadId ?? null]));
    return { thesis: thesisView(t, { includeSalt: true }), currentPrice: price, summary: describe(t) };
  });

  r.post("/theses/:id/prepare", { schema: { tags: ["theses"], summary: "Prepare the unsigned publish (or commit) transaction", params: z.object({ id: uuid }) } }, async (req) => {
    const a = requireCsrf(req);
    const t = await loadThesis(deps, a.userId, req.params.id);
    if (t.author_id !== a.userId) throw forbidden("NOT_AUTHOR", "Only the author can publish");
    if (t.chain_status !== "draft") throw conflict("ALREADY_ONCHAIN", "Thesis already on-chain; its terms are immutable");
    // refresh the deadline so the observation window matches the declared horizon from now
    let terms = termsFromJson(t.terms);
    terms = { ...terms, evaluationDeadline: BigInt(deps.now() + t.horizon_hours * 3600) };
    const commitment = computeThesisCommitment({ chainId: deps.contracts.chainId, registry: deps.contracts.thesis, author: getAddress(t.author_wallet), terms, salt: t.salt });
    await deps.db.as(a.userId, (q) => q(`UPDATE theses SET terms = $2, commitment = $3 WHERE id = $1 AND chain_status = 'draft'`, [t.id, termsToJson(terms), commitment]));
    const from = getAddress(t.author_wallet);
    const tx = t.visibility === "PUBLIC"
      ? atlasCalls.publishThesis(deps.contracts.chainId, from, deps.contracts.thesis, terms, t.salt)
      : atlasCalls.commitThesis(deps.contracts.chainId, from, deps.contracts.thesis, commitment, terms.evaluationDeadline);
    return { ...wrapTx(deps, tx), commitment, summary: describe({ ...t, terms: termsToJson(terms) }), privacyWarning: "Publishing reveals your wallet address on public block explorers." };
  });

  r.post("/theses/:id/reveal", { schema: { tags: ["theses"], params: z.object({ id: uuid }) } }, async (req) => {
    const a = requireCsrf(req);
    const t = await loadThesis(deps, a.userId, req.params.id);
    if (t.author_id !== a.userId) throw forbidden("NOT_AUTHOR", "Only the author can reveal");
    if (t.chain_status !== "committed") throw conflict("NOT_COMMITTED", "Only committed theses can be revealed");
    return wrapTx(deps, atlasCalls.revealThesis(deps.contracts.chainId, getAddress(t.author_wallet), deps.contracts.thesis, BigInt(t.onchain_id), termsFromJson(t.terms), t.salt));
  });

  r.post("/theses/:id/cancel", { schema: { tags: ["theses"], params: z.object({ id: uuid }) } }, async (req) => {
    const a = requireCsrf(req);
    const t = await loadThesis(deps, a.userId, req.params.id);
    if (t.author_id !== a.userId) throw forbidden("NOT_AUTHOR", "Only the author can cancel");
    if (t.chain_status === "draft") {
      await deps.db.as(a.userId, (q) => q(`UPDATE theses SET chain_status = 'cancelled', outcome = 'Cancelled' WHERE id = $1`, [t.id]));
      return { ok: true, note: "Draft discarded (it was never on-chain)." };
    }
    if (t.chain_status === "cancelled") throw conflict("ALREADY_CANCELLED", "Already cancelled");
    return { ...wrapTx(deps, atlasCalls.cancelThesis(deps.contracts.chainId, getAddress(t.author_wallet), deps.contracts.thesis, BigInt(t.onchain_id))), note: "Cancelling after the window started counts as a loss in your record." };
  });

  r.post("/theses/:id/confirm", { schema: { tags: ["theses"], summary: "Confirm a publish/commit/reveal/cancel/correction transaction", params: z.object({ id: uuid }), body: z.object({ txHash }) } }, async (req) => {
    const a = requireCsrf(req);
    const t = await loadThesis(deps, a.userId, req.params.id);
    if (t.author_id !== a.userId) throw forbidden("NOT_AUTHOR", "Only the author can confirm");
    const { events, receipt, blockTime } = await receiptEvents(deps, req.body.txHash as Hex, deps.contracts.thesis, AtlasThesisRegistryAbi as Abi, t.author_wallet);
    const mine = events.filter((e) => String(e.args.commitment ?? "").toLowerCase() === t.commitment || (t.onchain_id && e.args.thesisId?.toString() === t.onchain_id));
    if (!mine.length) throw bad("NO_MATCHING_EVENT", "That transaction did not publish this thesis' commitment");
    await deps.db.sysTx(async (q) => { for (const e of mine) await applyChainEvent(q, deps, { ...e, txHash: req.body.txHash, blockNumber: receipt.blockNumber, blockTime, contract: "thesis" }); });
    const after = await loadThesis(deps, a.userId, t.id);
    return { thesis: thesisView(after, { includeSalt: true }), txUrl: explorerTx(deps.contracts.chainId, req.body.txHash), finality: "included; final after the indexer sees enough confirmations" };
  });

  r.get("/theses", { schema: { tags: ["theses"], querystring: z.object({ author: uuid.optional(), asset: z.string().optional(), outcome: z.string().optional(), mine: z.coerce.boolean().optional(), limit: z.coerce.number().int().min(1).max(100).default(30) }) } }, async (req) => {
    const viewer = req.auth?.userId ?? null;
    const conds: string[] = [];
    const p: unknown[] = [];
    if (req.query.mine && viewer) { p.push(viewer); conds.push(`t.author_id = $${p.length}`); } else conds.push(`t.chain_status <> 'draft'`);
    if (req.query.author) { p.push(req.query.author); conds.push(`t.author_id = $${p.length}`); }
    if (req.query.asset) { p.push(req.query.asset.toUpperCase()); conds.push(`t.asset = $${p.length}`); }
    if (req.query.outcome) { p.push(req.query.outcome); conds.push(`t.outcome = $${p.length}`); }
    const rows = await deps.db.as(viewer, (q) => q(`SELECT t.*, row_to_json(pr) AS author FROM theses t JOIN profiles pr ON pr.user_id = t.author_id WHERE ${conds.join(" AND ")} ORDER BY t.created_at DESC LIMIT ${req.query.limit}`, p));
    return rows.map((t) => ({ ...thesisView(t, { includeSalt: t.author_id === viewer }), author: publicProfile(t.author) }));
  });

  r.get("/theses/:id", { schema: { tags: ["theses"], params: z.object({ id: uuid }) } }, async (req) => {
    const viewer = req.auth?.userId ?? null;
    const t = await loadThesis(deps, viewer, req.params.id);
    const [author] = await deps.db.sys(`SELECT ${PROFILE_COLUMNS} FROM profiles p WHERE p.user_id = $1`, [t.author_id]);
    const corrections = await deps.db.sys(`SELECT id, note, note_hash, tx_hash, idx, created_at FROM thesis_corrections WHERE thesis_id = $1 ORDER BY created_at`, [t.id]);
    const stance = await deps.db.sys(`SELECT stance, count(*)::int AS n FROM reviews WHERE thesis_id = $1 GROUP BY stance`, [t.id]);
    const [post] = await deps.db.sys(`SELECT id, moderation_status FROM posts WHERE thesis_id = $1 LIMIT 1`, [t.id]);
    const price = await deps.market.ticker24h(t.symbol).catch(() => null);
    return {
      ...thesisView(t, { includeSalt: t.author_id === viewer }),
      author: publicProfile(author),
      corrections,
      reviewSummary: Object.fromEntries(stance.map((s) => [s.stance, s.n])),
      postId: post?.id ?? null,
      moderation: post?.moderation_status === "removed" ? "Hidden on ATLAS by moderation. The on-chain record is immutable and still exists." : null,
      market: price ? { lastPrice: price.lastPrice, change24h: price.priceChangePercent, source: deps.market.id, simulated: deps.market.simulated } : null,
      summary: describe(t),
    };
  });

  r.get("/theses/:id/proofs", { schema: { tags: ["theses"], summary: "Independently checkable evidence for a thesis", params: z.object({ id: uuid }) } }, async (req) => {
    const viewer = req.auth?.userId ?? null;
    const t = await loadThesis(deps, viewer, req.params.id);
    const revealed = t.chain_status === "published" || t.author_id === viewer;
    const checks: { name: string; ok: boolean | null; detail: string }[] = [];
    if (revealed) {
      const terms = termsFromJson(t.terms);
      const recomputed = computeThesisCommitment({ chainId: Number(t.chain_id), registry: getAddress(t.registry), author: getAddress(t.author_wallet), terms, salt: t.salt });
      checks.push({ name: "commitment", ok: recomputed === t.commitment, detail: `keccak(ATLAS_THESIS_V1, chainId, registry, author, terms, salt) = ${recomputed}` });
      checks.push({ name: "contentHash", ok: thesisContentHash(t.content) === t.content_hash && terms.contentHash === t.content_hash, detail: "canonical JSON of the research text hashes to terms.contentHash" });
      checks.push({ name: "methodology", ok: terms.methodologyHash === METHODOLOGY_M1_HASH, detail: `${METHODOLOGY_M1.id} ${METHODOLOGY_M1_HASH}` });
    }
    let onchain: any = null;
    if (t.onchain_id) {
      try {
        const rec = (await deps.chain.readContract({ address: getAddress(t.registry), abi: AtlasThesisRegistryAbi, functionName: "getThesis", args: [BigInt(t.onchain_id)] })) as any;
        onchain = JSON.parse(JSON.stringify(rec, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
        checks.push({ name: "onchainCommitmentUnchanged", ok: String(rec.commitment).toLowerCase() === t.commitment, detail: "the registry still stores the original commitment (terms cannot be edited)" });
        checks.push({ name: "onchainAuthor", ok: String(rec.author).toLowerCase() === t.author_wallet, detail: "registry author equals the ATLAS account's verified Agent ID wallet" });
      } catch (e) {
        checks.push({ name: "onchainRead", ok: null, detail: `could not read registry: ${(e as Error).message.slice(0, 120)}` });
      }
    }
    if (t.evidence && t.evidence_hash) checks.push({ name: "outcomeEvidence", ok: verifyEvidence(t.evidence, t.evidence_hash), detail: "outcome evidence re-hashes to the recorded evidenceHash" });
    const events = await deps.db.sys(`SELECT name, args, tx_hash, block_number, block_time, status FROM chain_events WHERE chain_id = $1 AND (args->>'thesisId') = $2 ORDER BY block_number, log_index`, [t.chain_id, t.onchain_id ?? "-1"]);
    return {
      thesisId: t.id, chainId: Number(t.chain_id), registry: t.registry, onchainId: t.onchain_id, commitment: t.commitment,
      publishTx: t.publish_tx, publishTxUrl: t.publish_tx ? explorerTx(Number(t.chain_id), t.publish_tx) : null,
      onchain, checks, events: events.map((e) => ({ ...e, txUrl: explorerTx(Number(t.chain_id), e.tx_hash) })),
      evidence: t.evidence, evidenceHash: t.evidence_hash, methodology: METHODOLOGY_M1,
      separation: { prediction: "the committed terms above", outcome: t.outcome, execution: "trade proofs are separate and must be independently verified; an outcome is not realized P&L" },
    };
  });

  r.post("/theses/:id/evaluate", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } }, schema: { tags: ["theses"], summary: "Run the deterministic ATLAS-M1 evaluation now (does not write on-chain)", params: z.object({ id: uuid }) } }, async (req) => {
    const viewer = req.auth?.userId ?? null;
    const t = await loadThesis(deps, viewer, req.params.id);
    if (t.chain_status !== "published" || !t.start_time) throw conflict("NOT_PUBLISHED", "Only revealed on-chain theses can be evaluated");
    const ev = await evaluateWithProvider(deps.market, { terms: termsFromJson(t.terms), startTime: Math.floor(new Date(t.start_time).getTime() / 1000), symbol: t.symbol, now: deps.now() });
    return ev;
  });

  // ---------------------------------------------------------------- corrections (append-only)
  r.post("/theses/:id/corrections", { schema: { tags: ["theses"], params: z.object({ id: uuid }), body: z.object({ note: z.string().min(3).max(2000) }) } }, async (req) => {
    const a = requireCsrf(req);
    const t = await loadThesis(deps, a.userId, req.params.id);
    if (t.author_id !== a.userId) throw forbidden("NOT_AUTHOR", "Only the author can append corrections");
    if (!t.onchain_id) throw conflict("NOT_ONCHAIN", "Corrections apply to on-chain theses; edit the draft instead");
    const h = noteHash(req.body.note);
    const [c] = await deps.db.sys(`INSERT INTO thesis_corrections (thesis_id, note, note_hash) VALUES ($1,$2,$3) RETURNING id`, [t.id, req.body.note, h]);
    return { correctionId: c.id, noteHash: h, ...wrapTx(deps, atlasCalls.appendCorrection(deps.contracts.chainId, getAddress(t.author_wallet), deps.contracts.thesis, BigInt(t.onchain_id), h)) };
  });

  // ---------------------------------------------------------------- reviews & challenges
  r.get("/theses/:id/reviews", { schema: { tags: ["theses"], params: z.object({ id: uuid }) } }, async (req) => {
    const viewer = req.auth?.userId ?? null;
    await loadThesis(deps, viewer, req.params.id);
    const rows = await deps.db.sys(`SELECT r.*, row_to_json(p) AS reviewer FROM reviews r JOIN profiles p ON p.user_id = r.reviewer_id WHERE r.thesis_id = $1 ORDER BY r.created_at`, [req.params.id]);
    const challenges = await deps.db.sys(`SELECT c.*, p.agent_name FROM evidence_challenges c LEFT JOIN profiles p ON p.user_id = c.challenger_id WHERE c.thesis_id = $1 ORDER BY c.created_at`, [req.params.id]);
    return {
      reviews: rows.map((x) => ({ id: x.id, stance: x.stance, body: x.body, contentHash: x.content_hash, onchain: x.onchain_status === "published", txHash: x.tx_hash, txUrl: x.tx_hash ? explorerTx(deps.contracts.chainId, x.tx_hash) : null, reviewer: publicProfile(x.reviewer), createdAt: x.created_at })),
      challenges: challenges.map((c) => ({ id: c.id, kind: c.kind, reason: c.reason, evidenceHash: c.evidence_hash, txHash: c.tx_hash, challenger: c.agent_name, createdAt: c.created_at })),
    };
  });

  r.post("/theses/:id/reviews", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } }, schema: { tags: ["theses"], params: z.object({ id: uuid }), body: z.object({ stance: z.enum(["ENDORSE", "DISPUTE", "NEUTRAL"]), body: z.string().min(1).max(5000), onchain: z.boolean().default(true) }) } }, async (req) => {
    const a = requireCsrf(req);
    const t = await loadThesis(deps, a.userId, req.params.id);
    if (t.chain_status === "draft") throw conflict("NOT_ONCHAIN", "Drafts cannot be reviewed");
    if (t.author_id === a.userId) throw forbidden("SELF_REVIEW", "Authors cannot review their own thesis");
    const contentHash = hashCanonical({ v: 1, thesis: t.onchain_id ?? t.id, stance: req.body.stance, body: req.body.body });
    try {
      await deps.db.sys(`INSERT INTO reviews (thesis_id, reviewer_id, stance, body, content_hash) VALUES ($1,$2,$3,$4,$5)`, [t.id, a.userId, req.body.stance, req.body.body, contentHash]);
    } catch (e: any) {
      if (e?.code === "23505") throw conflict("ALREADY_REVIEWED", "You already reviewed this thesis");
      throw e;
    }
    await deps.notify.enqueue({ kind: "thesis.reviewed", recipientId: t.author_id, actorId: a.userId, subjectId: t.id, dedupeKey: `review:${t.id}:${a.userId}`, data: { stance: req.body.stance } });
    const wallet = await walletOf(deps.db.sys, a.userId);
    const stance = req.body.stance === "ENDORSE" ? ReviewStance.Endorse : req.body.stance === "DISPUTE" ? ReviewStance.Dispute : ReviewStance.Neutral;
    return {
      ok: true, contentHash,
      onchain: req.body.onchain && t.onchain_id && wallet ? wrapTx(deps, atlasCalls.publishReview(deps.contracts.chainId, getAddress(wallet), deps.contracts.review, BigInt(t.onchain_id), stance, contentHash)) : null,
    };
  });

  r.post("/theses/:id/reviews/confirm", { schema: { tags: ["theses"], params: z.object({ id: uuid }), body: z.object({ txHash }) } }, async (req) => {
    const a = requireCsrf(req);
    const wallet = await walletOf(deps.db.sys, a.userId);
    const { events, receipt, blockTime } = await receiptEvents(deps, req.body.txHash as Hex, deps.contracts.review, AtlasReviewRegistryAbi as Abi, wallet!);
    if (!events.length) throw bad("NO_MATCHING_EVENT", "No ATLAS review event in that transaction");
    await deps.db.sysTx(async (q) => { for (const e of events) await applyChainEvent(q, deps, { ...e, txHash: req.body.txHash, blockNumber: receipt.blockNumber, blockTime, contract: "review" }); });
    return { ok: true };
  });

  r.post("/theses/:id/challenges", { schema: { tags: ["theses"], params: z.object({ id: uuid }), body: z.object({ kind: z.enum(["ThesisContent", "TradeProof", "OutcomeEvidence", "MarketData"]), evidenceHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(), reason: z.string().min(10).max(2000) }) } }, async (req) => {
    const a = requireCsrf(req);
    const t = await loadThesis(deps, a.userId, req.params.id);
    if (!t.onchain_id) throw conflict("NOT_ONCHAIN", "Only on-chain theses can be challenged");
    const evidenceHash = (req.body.evidenceHash ?? (req.body.kind === "OutcomeEvidence" ? t.evidence_hash : t.content_hash)) as Hex;
    if (!evidenceHash) throw bad("NO_EVIDENCE", "No evidence hash to challenge yet");
    const reasonHash = hashCanonical({ v: 1, reason: req.body.reason });
    await deps.db.sys(`INSERT INTO evidence_challenges (thesis_id, challenger_id, kind, evidence_hash, reason, reason_hash) VALUES ($1,$2,$3,$4,$5,$6)`, [t.id, a.userId, req.body.kind, evidenceHash.toLowerCase(), req.body.reason, reasonHash]);
    await deps.notify.enqueue({ kind: "thesis.challenged", recipientId: t.author_id, actorId: a.userId, subjectId: t.id, dedupeKey: `challenge:${t.id}:${a.userId}:${reasonHash}`, data: { kind: req.body.kind } });
    const wallet = await walletOf(deps.db.sys, a.userId);
    return wrapTx(deps, atlasCalls.challengeEvidence(deps.contracts.chainId, getAddress(wallet!), deps.contracts.review, BigInt(t.onchain_id), EvidenceKind[req.body.kind], evidenceHash, reasonHash));
  });
}

export function describe(t: any) {
  const dir = t.direction === "LONG" ? "rise" : "fall";
  const entry = t.entry_kind === "MARKET" ? "from the first full hour after publication" : `once price is ${t.entry_kind === "AT_OR_BELOW" ? "at or below" : "at or above"} ${t.entry_price}`;
  const deadline = t.terms?.evaluationDeadline ? new Date(Number(t.terms.evaluationDeadline) * 1000).toISOString() : "the deadline";
  return `Predicts ${t.symbol} will ${dir} to ${t.target_price} before touching ${t.invalidation_price}, ${entry}, evaluated on Binance 1h candles until ${deadline} (ATLAS-M1). Confidence ${t.confidence}%.`;
}
