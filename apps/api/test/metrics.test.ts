/** Audit 2026-11-20 F6: distinct Agent ID addresses with on-chain ATLAS interactions. */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { harness, type Harness } from "./helpers.js";

let h: Harness;
beforeAll(async () => { h = await harness(); });
afterAll(async () => { await h?.close(); });

let n = 0;
const ev = (name: string, args: Record<string, unknown>, status: "final" | "provisional" = "final") => h.deps.db.sys(
  `INSERT INTO chain_events (id, chain_id, contract, name, args, address, block_number, block_hash, block_time, log_index, tx_hash, status)
   VALUES ($1,$2,'x',$3,$4,'0x0000000000000000000000000000000000000001',$5,$6,now(),0,$6,$7)`,
  [`m-${++n}`, h.deps.contracts.chainId, name, JSON.stringify(args), 1000 + n, `0x${n.toString(16).padStart(64, "0")}`, status]);

describe("on-chain Agent ID interaction metric", () => {
  it("counts distinct actor addresses across Agent-ID-gated actions; excludes evaluator, finalize, recipients and provisional events", async () => {
    const A = "0xAAAA000000000000000000000000000000000001", B = "0xbbbb000000000000000000000000000000000002", C = "0xcccc000000000000000000000000000000000003";
    await ev("IdentityRegistered", { wallet: A });
    await ev("ThesisCommitted", { author: A.toLowerCase() }); // same address, different case and action: counted once
    await ev("ReviewPublished", { reviewer: B });
    await ev("PaymentSent", { sender: B, recipient: "0xdddd000000000000000000000000000000000004" }); // recipient is not counted
    await ev("OutcomeProposed", { evaluator: "0xeeee000000000000000000000000000000000005" }); // evaluator service: excluded
    await ev("OutcomeFinalized", { thesisId: "1" });
    await ev("OutcomeChallenged", { challenger: C }, "provisional"); // not final yet
    const r = (await h.app.inject({ method: "GET", url: "/metrics/onchain-agents" })).json();
    expect(r).toMatchObject({ include: "final", distinctAgentIdAddresses: 2, events: 4 });
    expect(r.byAction.IdentityRegistered.distinctAddresses).toBe(1);
    expect(r.byAction.OutcomeProposed).toBeUndefined();
    expect(r.method).toMatch(/Excludes evaluator/);
    expect(JSON.stringify(r)).not.toMatch(/0xaaaa|0xbbbb/i); // counts only, never the address list
    const all = (await h.app.inject({ method: "GET", url: "/metrics/onchain-agents?include=all" })).json();
    expect(all.distinctAgentIdAddresses).toBe(3);
  });
});
