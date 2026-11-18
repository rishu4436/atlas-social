import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computePerformance, wilsonLower, type ThesisRecord } from "../src/index.js";

const outcomes = ["TargetHit", "InvalidationHit", "Expired", "Unresolved", "Void", "Forfeited", "Open", "Cancelled"] as const;
function sample(seed: number, n: number): ThesisRecord[] {
  let s = seed;
  const r = () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  return Array.from({ length: n }, (_, i) => {
    const o = outcomes[Math.floor(r() * outcomes.length)]!;
    const hasRet = ["TargetHit", "InvalidationHit", "Expired"].includes(o);
    return { outcome: o, returnBps: hasRet ? Math.round((r() - 0.4) * 2000) : null, confidence: Math.round(r() * 100), onchain: r() > 0.1, resolvedAt: hasRet ? 1000 + i : null, cancelledAfterStart: o === "Cancelled" ? r() > 0.5 : false };
  });
}

describe("reputation v1", () => {
  it("counts forfeits and post-start cancels as losses; ignores off-chain", () => {
    const s = computePerformance([
      { outcome: "TargetHit", returnBps: 1000, confidence: 70, onchain: true, resolvedAt: 1 },
      { outcome: "InvalidationHit", returnBps: -500, confidence: 60, onchain: true, resolvedAt: 2 },
      { outcome: "Forfeited", returnBps: null, confidence: 50, onchain: true, resolvedAt: null },
      { outcome: "Cancelled", returnBps: null, confidence: 50, onchain: true, resolvedAt: null, cancelledAfterStart: true },
      { outcome: "Cancelled", returnBps: null, confidence: 50, onchain: true, resolvedAt: null, cancelledAfterStart: false },
      { outcome: "TargetHit", returnBps: 900, confidence: 90, onchain: false, resolvedAt: 3 },
    ]);
    expect(s).toMatchObject({ published: 5, wins: 1, losses: 3, scored: 4, forfeited: 1, maxDrawdownBps: 500, cumulativeReturnBps: 500 });
    expect(s.sampleWarning).toMatch(/Small sample/);
  });
  it("empty record is neutral and safe", () => {
    const s = computePerformance([]);
    expect(s.reputation).toBe(0);
    expect(s.hitRate).toBeNull();
  });
  it("wilson bound", () => {
    expect(wilsonLower(0, 0)).toBeNull();
    expect(wilsonLower(10, 10)!).toBeLessThan(1);
  });

  const py = process.env.ATLAS_PYTHON ?? "/workspace/.atlas-run/pyenv/bin/python";
  it.skipIf(!existsSync(py))("Python/Polars implementation matches TypeScript exactly", () => {
    const dir = mkdtempSync(join(tmpdir(), "rep-"));
    for (const seed of [1, 7, 42, 99, 2026]) {
      const recs = sample(seed, 5 + (seed % 60));
      const f = join(dir, `${seed}.json`);
      writeFileSync(f, JSON.stringify(recs));
      const out = JSON.parse(execFileSync(py, [join(__dirname, "..", "analytics", "reputation.py"), f], { encoding: "utf8" }));
      expect(out).toEqual(computePerformance(recs));
    }
  });
});
