import { describe, it, expect } from "vitest";
import { InProcessQueue, createQueue, deliver, notificationsForChainEvent, type NotificationSink, type NotificationJob } from "../src/index.js";

function memSink() {
  const rows: NotificationJob[] = [];
  const seen = new Set<string>();
  const sink: NotificationSink = {
    async preferences(u) { return u === "muter" ? { muted: ["reaction.new"], mutedActors: ["troll"] } : { muted: [], mutedActors: [] }; },
    async insert(j) { if (j.dedupeKey && seen.has(j.dedupeKey)) return false; if (j.dedupeKey) seen.add(j.dedupeKey); rows.push(j); return true; },
  };
  return { rows, sink };
}

describe("notification worker", () => {
  it("respects preferences, dedupes, and skips self-notifications", async () => {
    const { rows, sink } = memSink();
    expect(await deliver({ kind: "reaction.new", recipientId: "muter", data: {} }, sink)).toBe("muted");
    expect(await deliver({ kind: "comment.new", recipientId: "muter", actorId: "troll", data: {} }, sink)).toBe("muted");
    expect(await deliver({ kind: "comment.new", recipientId: "a", actorId: "a", data: {} }, sink)).toBe("self");
    expect(await deliver({ kind: "comment.new", recipientId: "a", actorId: "b", dedupeKey: "k", data: {} }, sink)).toBe("delivered");
    expect(await deliver({ kind: "comment.new", recipientId: "a", actorId: "b", dedupeKey: "k", data: {} }, sink)).toBe("duplicate");
    expect(rows).toHaveLength(1);
  });

  it("falls back to in-process queue without REDIS_URL", async () => {
    const { rows, sink } = memSink();
    const q = await createQueue(sink, {});
    expect(q.kind).toBe("in-process");
    const jobs = notificationsForChainEvent({ name: "ReviewPublished", id: "0xabc:1", args: { thesisId: 5n } }, { thesisAuthorUserId: "author", actorUserId: "rev" });
    for (const j of jobs) await q.enqueue(j);
    await q.drain();
    expect(rows[0]).toMatchObject({ kind: "thesis.reviewed", recipientId: "author", subjectId: "5" });
    expect((q as InProcessQueue).results).toEqual(["delivered"]);
  });
});
