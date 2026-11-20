/**
 * The two handoffs. Each baw step is: preview → show everything → explicit "yes" → execute.
 * ATLAS supplies data (typed data, unsigned steps); this file decides which baw command runs and validates every value.
 */
import { ADDRESS, CHAIN, DECIMAL, HEX, SAFE_ID, WEI, type BawRunner } from "./baw.js";
import { AtlasApiError, type Api } from "./api.js";

export interface Io { log(s: string): void; ask(q: string): Promise<string> }
export interface Ctx { api: Api; baw: BawRunner; io: Io; sleep?: (ms: number) => Promise<void>; pollMs?: number; pollTimeoutMs?: number }

export class StopError extends Error { constructor(message: string, public exitCode = 1) { super(message); } }

const sleepDefault = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function report(ctx: Ctx, code: string, stage: string, extra: { bawCode?: string; errorCode?: string } = {}) {
  const bawCode = extra.bawCode && /^\d{3,9}$/.test(extra.bawCode) ? extra.bawCode : undefined;
  const errorCode = extra.errorCode && /^[A-Z0-9_]{2,40}$/.test(extra.errorCode) ? extra.errorCode : undefined;
  await ctx.api("report", { code, stage, bawCode, errorCode }).catch(() => undefined); // progress only; never blocks
}

async function approve(ctx: Ctx, what: string) {
  const a = (await ctx.io.ask(`\n${what}\nType "yes" to approve, anything else cancels: `)).trim().toLowerCase();
  if (a !== "yes") throw new StopError("Cancelled. Nothing was signed or sent.", 3);
}

function showRisks(io: Io, risks: any) {
  const details: any[] = risks?.riskDetails ?? [];
  const addrs = Object.entries(risks?.addresses ?? {}).filter(([, v]: any) => v?.riskDetails?.length);
  if (!details.length && !addrs.length) { io.log("  Risks: none reported by Binance Agentic Wallet"); return; }
  io.log("  RISKS reported by Binance Agentic Wallet:");
  for (const r of details) io.log(`   - [${r.riskType ?? "RISK"}] ${r.title}: ${r.description}`);
  for (const [a, v] of addrs as any) for (const r of v.riskDetails) io.log(`   - address ${a} (${v.riskLevel}): ${r.title}: ${r.description}`);
}

async function walletPrecheck(ctx: Ctx, code: string, needDevMode: boolean) {
  const st = await ctx.baw(["wallet", "status", "--json"]);
  if (!st.ok) throw new StopError(st.code === "BAW_NOT_INSTALLED" ? st.message : `baw wallet status failed: ${st.message}`);
  if (st.data?.status !== "CONNECTED") throw new StopError("Your Binance Agentic Wallet CLI is not signed in. Run `baw auth signin` yourself (that pairing is between you and Binance), then run this again.", 2);
  const ad = await ctx.baw(["wallet", "address", "--json"]);
  const bsc = ad.ok ? (ad.data?.addresses ?? []).find((a: any) => String(a.binanceChainId) === "56")?.address : null;
  if (!bsc || !ADDRESS.test(bsc)) throw new StopError("Could not read your BSC address from `baw wallet address`.");
  const id = await ctx.baw(["wallet", "agent-id", "--json"]);
  if (id.ok && id.data?.claimed === false) throw new StopError("This Agentic Wallet has no Agent ID yet. Claim one in the Binance App (Web3 wallet → Agent ID).", 2);
  if (!id.ok && id.code === "20003008") ctx.io.log("  (Agent ID service temporarily unavailable; ATLAS checks ownership on chain itself.)");
  if (needDevMode) {
    const s = await ctx.baw(["wallet", "settings", "--json"]);
    const dm = s.ok ? s.data?.devMode : null;
    if (dm && (dm.enabled === false || (dm.expiresAt && Number(dm.expiresAt) < Date.now()))) {
      await report(ctx, code, "failed", { bawCode: "351802" });
      throw new StopError("Developer Mode is off in your Binance App (needed for sign-message / contract-call). Turn it on: Agentic Wallet → Settings → Developer Mode, then run this again.", 2);
    }
  }
  ctx.io.log(`  Wallet: ${bsc}${id.ok && id.data?.agentId ? `  Agent ID: ${id.data.agentId}` : ""}`);
  return bsc as string;
}

/** The only message this companion signs: the ATLAS AtlasLogin typed data for THIS wallet and THIS loginId. */
export function checkSignRequest(signRequest: string, wallet: string, loginId: string, site: string) {
  const m = JSON.parse(signRequest);
  if (m.method !== "eth_signTypedData_v4" || !Array.isArray(m.params) || String(m.params[0]).toLowerCase() !== wallet.toLowerCase()) throw new StopError("Refusing: the sign request is not an eth_signTypedData_v4 request for your wallet.");
  const td = JSON.parse(m.params[1]);
  const msg = td.message ?? {};
  const ok = td.primaryType === "AtlasLogin" && td.domain?.name === "ATLAS Social" && String(msg.wallet).toLowerCase() === wallet.toLowerCase() && msg.loginId === loginId && msg.audience === site;
  if (!ok) throw new StopError("Refusing: the message is not the ATLAS login message for this wallet and connection.");
  return td;
}

async function waitSignature(ctx: Ctx, orderId: string) {
  const deadline = Date.now() + (ctx.pollTimeoutMs ?? 5 * 60_000);
  while (Date.now() < deadline) {
    await (ctx.sleep ?? sleepDefault)(ctx.pollMs ?? 3000);
    const r = await ctx.baw(["sign-message", "result", "--order-id", orderId, "--json"]);
    if (!r.ok) throw new StopError(`baw sign-message result failed: ${r.message}`);
    if (r.data?.status === "COMPLETED") return r.data;
    if (r.data?.status === "REJECTED" || r.data?.status === "EXPIRED") throw new StopError(`Signature ${r.data.status.toLowerCase()} in the Binance App. Nothing was signed.`);
  }
  throw new StopError("Timed out waiting for confirmation in the Binance App.");
}

export async function runLogin(ctx: Ctx, code: string) {
  const { io } = ctx;
  const open = await ctx.api("open", { code });
  if (open.purpose === "pay") throw new StopError("This code is for a payment. Run: atlas-baw-connect pay <code>");
  io.log(`ATLAS Connect — ${open.purpose === "step-up" ? "wallet check for your signed-in session" : "sign in"} at ${open.site}`);
  io.log(`  Code expires ${new Date(open.expiresAt * 1000).toLocaleTimeString()}. ATLAS asks for ONE signature: the AtlasLogin message. No approvals, no funds.`);
  const wallet = await walletPrecheck(ctx, code, true);
  const ch = await ctx.api("challenge", { code, wallet });
  const td = checkSignRequest(ch.signRequest, wallet, ch.loginId, open.site);
  if (!CHAIN.test(String(ch.chainId))) throw new StopError("Bad chain id from ATLAS");
  io.log(`  Agent ID detected by ATLAS: ${ch.agentName}`);
  await report(ctx, code, "previewing");
  const pv = await ctx.baw(["sign-message", "preview", "--binanceChainId", String(ch.chainId), "--signType", "EIP712", "--message", ch.signRequest, "--json"]);
  if (!pv.ok) {
    await report(ctx, code, "failed", { bawCode: pv.code ?? undefined });
    const hint = pv.code === "953004" ? " Known upstream issue binance-skills-hub#400 (https://github.com/binance/binance-skills-hub/issues/400). Use the on-chain fallback on the website." : "";
    throw new StopError(`baw sign-message preview failed${pv.code ? ` (${pv.code})` : ""}: ${pv.message}.${hint}`);
  }
  if (!pv.data?.requestId || !SAFE_ID.test(pv.data.requestId)) throw new StopError("Preview returned no usable requestId (intercepted?). Not signing.");
  io.log("\nPreview from Binance Agentic Wallet:");
  io.log(`  Type: ${pv.data.parsedMessage?.messageType ?? "SignTypedData"} ${pv.data.parsedMessage?.version ?? ""}`);
  io.log(`  Domain: ${td.domain.name} v${td.domain.version} (chainId ${td.domain.chainId})`);
  io.log(`  Statement: ${td.message.statement}`);
  io.log(`  Site: ${td.message.audience}   Wallet: ${td.message.wallet}`);
  io.log(`  Login id: ${td.message.loginId}   Expires: ${new Date(Number(td.message.expiresAt) * 1000).toLocaleTimeString()}`);
  showRisks(io, pv.data.risks);
  if (pv.data.requireConfirmation) io.log("  After you approve here, the Binance App will also ask you to confirm.");
  await report(ctx, code, "awaiting_user_approval");
  await approve(ctx, `Sign the ATLAS login message as ${ch.agentName}?`);
  const ex = await ctx.baw(["sign-message", "execute", "--requestId", pv.data.requestId, "--json"]);
  if (!ex.ok) { await report(ctx, code, "failed", { bawCode: ex.code ?? undefined }); throw new StopError(`baw sign-message execute failed: ${ex.message}`); }
  let sig = ex.data;
  if (sig?.status === "PENDING_CONFIRMATION") {
    if (!SAFE_ID.test(String(sig.orderId))) throw new StopError("Bad orderId from baw");
    await report(ctx, code, "awaiting_app_confirmation");
    io.log("  Confirm the signature in your Binance App…");
    sig = await waitSignature(ctx, sig.orderId);
  }
  if (sig?.status !== "COMPLETED" || !sig.signature) throw new StopError("No signature returned.");
  await report(ctx, code, "signed");
  try {
    const done = await ctx.api("complete", { code, loginId: ch.loginId, signature: sig.signature, recovery: sig.signatureRecovery ?? undefined });
    io.log(`\n✔ ATLAS verified the signature and your Agent ID (${done.agentName}).`);
    io.log("  Go back to the ATLAS tab in your browser and confirm it is you. This code cannot sign anyone in anywhere else.");
  } catch (e) {
    if (e instanceof AtlasApiError) throw new StopError(`ATLAS rejected the proof: ${e.code} — ${e.message}`);
    throw e;
  }
}

export async function runPay(ctx: Ctx, code: string) {
  const { io } = ctx;
  const open = await ctx.api("open", { code });
  if (open.purpose !== "pay") throw new StopError("This code is not a payment. Run: atlas-baw-connect login <code>");
  const p = open.payment;
  for (const a of [p.from, p.recipient?.address]) if (!ADDRESS.test(String(a))) throw new StopError("Bad address in payment");
  if (!DECIMAL.test(String(p.amount))) throw new StopError("Bad amount in payment");
  io.log(`ATLAS Pay — review carefully (payments are final once confirmed):`);
  io.log(`  To:       ${p.recipient.agentName}${p.recipient.displayName ? ` (${p.recipient.displayName})` : ""}`);
  io.log(`  Address:  ${p.recipient.address}`);
  io.log(`  Network:  ${p.network?.name ?? "?"} (chainId ${p.network?.chainId})`);
  io.log(`  Amount:   ${p.amount} ${p.asset}${p.stableIsMock ? " (local MOCK token)" : ""}`);
  io.log(`  From:     ${p.from}`);
  if (p.gasEstimate) io.log(`  Fee est.: ${p.gasEstimate.feeBnb ?? "shown by your wallet"} BNB (${p.gasEstimate.estimated ? "simulated" : "approximate"})`);
  const wallet = await walletPrecheck(ctx, code, p.mode === "contract-call");
  if (wallet.toLowerCase() !== String(p.from).toLowerCase()) throw new StopError(`This payment is prepared for ${p.from}, but your Agentic Wallet is ${wallet}. Stopping.`);

  if (p.mode === "contract-call") {
    for (const [i, s] of (p.steps as any[]).entries()) {
      if (!ADDRESS.test(s.to) || !HEX.test(s.data) || s.data.length > 200_000 || !WEI.test(String(s.value)) || !CHAIN.test(String(s.chainId))) throw new StopError("Bad step from ATLAS");
      io.log(`\nStep ${i + 1}/${p.steps.length}: ${s.title}`);
      await report(ctx, code, "previewing");
      const pv = await ctx.baw(["contract-call", "preview", "--binanceChainId", String(s.chainId), "--from", wallet, "--to", s.to, "--value", String(s.value), "--inputData", s.data, "--json"]);
      if (!pv.ok) {
        await report(ctx, code, "failed", { bawCode: pv.code ?? undefined });
        throw new StopError(`baw contract-call preview failed${pv.code ? ` (${pv.code})` : ""}: ${pv.message}. Known issue: https://github.com/binance/binance-skills-hub/issues/375. Nothing was sent; use the fallback on the website.`);
      }
      if (!pv.data?.requestId || !SAFE_ID.test(pv.data.requestId)) throw new StopError("Preview intercepted or returned no requestId. Nothing was sent.");
      const t = pv.data.parsedTx ?? {};
      io.log(`  Binance preview: to ${t.to ?? s.to}  value ${t.amount ?? s.value} (smallest unit)  simulation: ${pv.data.simulationResult?.success === false ? "FAILS" : "ok"}`);
      if (pv.data.authorityChanges?.length) io.log(`  Authority changes: ${JSON.stringify(pv.data.authorityChanges)}`);
      showRisks(io, pv.data.risks);
      await report(ctx, code, "awaiting_user_approval");
      await approve(ctx, `Execute step ${i + 1} (${s.title}) from ${wallet}?`);
      const ex = await ctx.baw(["contract-call", "execute", "--requestId", pv.data.requestId, "--json"]);
      if (!ex.ok) { await report(ctx, code, "failed", { bawCode: ex.code ?? undefined }); throw new StopError(`baw contract-call execute failed: ${ex.message}`); }
      let hash = ex.data?.txHash as string | null;
      if (ex.data?.status === "PENDING_CONFIRMATION") {
        await report(ctx, code, "awaiting_app_confirmation");
        hash = (await ctx.io.ask("Confirm in your Binance App, then paste the transaction hash it shows (or from `baw wallet tx-history --json`): ")).trim();
      }
      if (!hash || !/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new StopError("No transaction hash; check `baw wallet tx-history --json`.");
      const r = await submitTx(ctx, code, i, hash);
      // audit F3: USDT approve and pay are separate transactions. Never send the pay step before the approval is mined.
      if (i < p.steps.length - 1 && r?.stepKind === "approve" && r?.nextStepAllowed !== true) await waitApprovalMined(ctx, code, i);
    }
  } else {
    const name = String(p.recipient.agentName);
    if (!/^[a-z0-9-]{1,63}\.ai$/i.test(name)) throw new StopError("Bad recipient name");
    if (!ADDRESS.test(String(p.tokenAddress))) throw new StopError("Bad token address");
    io.log("\nFallback (AtlasPay pending): resolve in your own wallet, compare, then send.");
    const rs = await ctx.baw(["wallet", "resolve-domain", "--name", name, "--binanceChainId", "56", "--json"]);
    if (!rs.ok || !ADDRESS.test(String(rs.data?.address))) { await report(ctx, code, "failed", { bawCode: rs.ok ? undefined : rs.code ?? undefined }); throw new StopError(`baw could not resolve ${name}. Payment blocked — do not retry with another name or chain.`); }
    io.log(`  baw resolved ${name} → ${rs.data.address} (${rs.data.addressType ?? "UNKNOWN"}${rs.data.isFallback ? ", FALLBACK record" : ""})`);
    if (rs.data.isFallback) io.log("  WARNING: no BSC-specific record; this is the domain's default address.");
    if (rs.data.addressType !== "EOA") io.log("  WARNING: the address is a contract or unknown type. Funds sent to a contract may be unrecoverable.");
    if (String(rs.data.address).toLowerCase() !== String(p.expectedRecipient).toLowerCase()) {
      await report(ctx, code, "failed", { errorCode: "RESOLVE_MISMATCH" });
      throw new StopError(`baw resolved ${rs.data.address}, but ATLAS shows the Agent ID owner ${p.expectedRecipient}. They differ — stopping. Nothing was sent.`);
    }
    io.log(`  ${p.addressBook ?? "The recipient must be in your Binance address book (Binance App → Wallet → Settings → Address Book)."}`);
    await report(ctx, code, "awaiting_user_approval");
    await approve(ctx, `Send ${p.amount} ${p.asset} to ${rs.data.address} on BSC?`);
    const sd = await ctx.baw(["wallet", "send", "--amount", String(p.amount), "--recipient", rs.data.address, "--binanceChainId", "56", "--tokenAddress", p.tokenAddress, "--json"]);
    if (!sd.ok || !/^0x[0-9a-fA-F]{64}$/.test(String(sd.data?.txHash))) { await report(ctx, code, "failed", { bawCode: sd.ok ? undefined : sd.code ?? undefined }); throw new StopError(`baw wallet send failed: ${sd.ok ? "no txHash" : sd.message}`); }
    await submitTx(ctx, code, 0, sd.data.txHash);
  }
  io.log("\nSubmitted — NOT paid yet. Stages: Broadcast → Mined → Confirmed → Finalized. ATLAS shows it as paid only once it is Finalized on-chain; follow it on the ATLAS tab.");
}

const FAILED = new Set(["reverted", "replaced", "dropped"]);

async function waitApprovalMined(ctx: Ctx, code: string, step: number) {
  const deadline = Date.now() + (ctx.pollTimeoutMs ?? 180_000);
  ctx.io.log("  Waiting for the approval to be mined before the pay step (an approval is not a payment)…");
  for (let n = 0; n < 120 && Date.now() < deadline; n++) {
    await (ctx.sleep ?? sleepDefault)(ctx.pollMs ?? 3000);
    const st = await ctx.api("tx-status", { code, step }).catch(() => null);
    if (!st) continue;
    if (FAILED.has(st.stage)) throw new StopError(`The approval ${st.stage}: ${st.stageLabel}. The pay step was not sent.`);
    if (st.nextStepAllowed) { ctx.io.log(`  ${st.stageLabel}`); return; }
  }
  throw new StopError("The approval is not mined yet. The pay step was not sent; rerun with the same code once it is mined.");
}

async function submitTx(ctx: Ctx, code: string, step: number, hash: string) {
  for (let i = 0; i < 10; i++) {
    try {
      const r = await ctx.api("tx", { code, step, txHash: hash });
      // "verified" = matches the reviewed step. It is not a payment confirmation.
      ctx.io.log(`  Tx ${hash} matches the reviewed step. Stage: ${r?.stageLabel ?? "Broadcast · not mined yet"}${r?.paid ? "" : " (not paid yet)"}.`);
      return r;
    } catch (e) {
      if (e instanceof AtlasApiError && e.code === "TX_NOT_FOUND") { await (ctx.sleep ?? sleepDefault)(ctx.pollMs ?? 3000); continue; }
      if (e instanceof AtlasApiError) throw new StopError(`ATLAS rejected the transaction: ${e.code} — ${e.message}`);
      throw e;
    }
  }
  throw new StopError(`Transaction ${hash} not visible on chain yet; check it with \`baw wallet tx-history --json\`.`);
}
