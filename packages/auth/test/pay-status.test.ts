import { describe, it, expect } from "vitest";
import { deriveStage, isPaid, stageView, PAY_STAGE_LABEL, PAY_STAGES } from "../src/pay-status.js";

describe("payment stage model (audit F3)", () => {
  it("the five honest stages, in order", () => {
    expect(PAY_STAGES).toEqual(["prepared", "broadcast", "mined", "confirmed", "finalized"]);
  });
  it("verified-but-not-mined is broadcast, never paid", () => {
    const s = deriveStage({ stepKind: "pay", known: true, receipt: null });
    expect(s).toBe("broadcast");
    expect(isPaid(s)).toBe(false);
    expect(stageView(s, "pay").paid).toBe(false);
  });
  it("delayed receipt: unknown to the node stays broadcast within the grace period, then dropped", () => {
    expect(deriveStage({ stepKind: "pay", known: false, ageSeconds: 30 })).toBe("broadcast");
    expect(deriveStage({ stepKind: "pay", known: false, ageSeconds: 3600 })).toBe("dropped");
  });
  it("a replaced tx (nonce consumed, no receipt) is reported as replaced", () => {
    expect(deriveStage({ stepKind: "pay", known: false, nonceConsumed: true })).toBe("replaced");
  });
  it("mined → confirmed (indexed provisional) → finalized; only finalized is paid", () => {
    expect(deriveStage({ stepKind: "pay", receipt: "success" })).toBe("mined");
    expect(deriveStage({ stepKind: "pay", receipt: "success", event: "provisional" })).toBe("confirmed");
    expect(deriveStage({ stepKind: "pay", receipt: "success", event: "final" })).toBe("finalized");
    for (const s of ["mined", "confirmed", "broadcast", "prepared"] as const) expect(isPaid(s)).toBe(false);
    expect(isPaid("finalized")).toBe(true);
  });
  it("a USDT approval is never a payment", () => {
    const s = deriveStage({ stepKind: "approve", receipt: "success", event: "final" });
    expect(s).toBe("approval_mined");
    expect(isPaid(s)).toBe(false);
    expect(PAY_STAGE_LABEL[s]).toMatch(/payment step still required/);
  });
  it("reverted is terminal and not paid", () => {
    expect(deriveStage({ stepKind: "pay", receipt: "reverted" })).toBe("reverted");
    expect(stageView("reverted", "pay")).toMatchObject({ paid: false, final: true });
  });
});

describe("plain baw transfers (fallback)", () => {
  it("are final by depth only, never via an event", () => {
    expect(deriveStage({ stepKind: "transfer", receipt: "success" })).toBe("mined");
    expect(deriveStage({ stepKind: "transfer", receipt: "success", deepEnough: true })).toBe("finalized");
    expect(deriveStage({ stepKind: "transfer", event: "final", receipt: null, known: true })).toBe("broadcast");
  });
});
