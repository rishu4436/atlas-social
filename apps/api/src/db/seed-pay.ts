/**
 * DEMO SEED for ATLAS Pay (local anvil only; the caller refuses chain 56). Every payment here is a REAL local-chain
 * transaction through the local AtlasPay + MockStable ("MOCK USDT (test only)"), prepared by the real API flow and
 * signed by seeded throwaway local keys. Receipts appear only after the API's indexer reads the PaymentSent events.
 */
import { parseEther, type Hex } from "viem";
import { MockStableAbi } from "@atlas/shared-types";

export async function seedPayDemo(deps: any, users: { c: any; id: string }[], wallet: (c: any) => any) {
  if (deps.contracts.chainId === 56) throw new Error("pay demo seed refuses chain 56");
  if (!deps.contracts.payDeployed) { console.log("pay demo: AtlasPay not deployed locally, skipped"); return; }
  const exec = async (u: any, steps: any[]) => {
    let last: Hex = "0x";
    for (const s of steps) {
      last = await wallet(u.c).sendTransaction({ to: s.to, data: s.data, value: BigInt(s.value) });
      await deps.chain.waitForTransactionReceipt({ hash: last });
    }
    return last;
  };
  const pay = async (from: any, to: any, body: any) => {
    const r = await from.c.req("POST", "/pay/recipient", { recipientUserId: to.id });
    const p = await from.c.req("POST", "/pay/prepare", { recipientUserId: to.id, expectedRecipient: r.address, ...body });
    return exec(from, p.steps);
  };
  for (const u of users.slice(0, 4)) {
    await deps.chain.waitForTransactionReceipt({ hash: await wallet(u.c).writeContract({ address: deps.contracts.stable, abi: MockStableAbi, functionName: "mint", args: [u.c.account.address, parseEther("500")] }) });
  }
  const [orion, vega, lyra, bot] = users as any[];
  const feed = await vega.c.req("GET", "/feed?tab=chronological&limit=50");
  const orionPost = feed.items.find((p: any) => p.author.userId === orion.id && p.kind === "post");
  if (orionPost) await pay(vega, orion, { asset: "BNB", amount: "0.05", kind: "tip", context: { kind: "post", id: orionPost.id }, memo: "Great liquidity read" });
  await pay(lyra, orion, { asset: "USDT", amount: "12", kind: "direct", context: { kind: "profile" } });
  // a request that gets paid, one left open in a DM, and one open share link
  const paid = await orion.c.req("POST", "/pay/requests", { asset: "USDT", amount: "25", note: "BNB liquidity map: data subscription share" });
  await pay(bot, orion, { asset: "USDT", amount: "25", kind: "request", context: { kind: "request", id: paid.id } });
  await orion.c.req("POST", "/follows", { userId: vega.id }).catch(() => {});
  await vega.c.req("POST", "/follows", { userId: orion.id }).catch(() => {});
  const m = await vega.c.req("POST", "/messages", { to: orion.id, body: "Thanks for the call notes, splitting the data feed with you." });
  const dmReq = await orion.c.req("POST", "/pay/requests", { asset: "BNB", amount: "0.02", note: "Half of this month's data feed", context: { kind: "dm", id: m.conversationId } });
  await orion.c.req("POST", "/messages", { conversationId: m.conversationId, body: `Payment request: ${dmReq.shareUrl}` });
  await pay(orion, vega, { asset: "BNB", amount: "0.01", kind: "direct", context: { kind: "dm", id: m.conversationId }, memo: "coffee" });
  await orion.c.req("POST", "/posts", { body: `Funding a community liquidity dashboard for BNB pairs. Chip in if it helps your research. #bnb\n\nPayment request: ${(await orion.c.req("POST", "/pay/requests", { asset: "USDT", amount: "15", note: "Community BNB liquidity dashboard" })).shareUrl}` });
  console.log("pay demo: 5 local AtlasPay payments (labelled local chain + mock USDT), 3 requests");
}
