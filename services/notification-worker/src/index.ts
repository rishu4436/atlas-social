import { z } from "zod";

export const NOTIFICATION_KINDS = [
  "thesis.reviewed", "thesis.challenged", "outcome.proposed", "outcome.challenged", "outcome.finalized",
  "follow.new", "reaction.new", "comment.new", "mention", "squad.invite", "message.new", "system",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const notificationJobSchema = z.object({
  kind: z.enum(NOTIFICATION_KINDS),
  recipientId: z.string().min(1),
  actorId: z.string().optional(),
  subjectId: z.string().optional(), // thesis/post/squad id
  dedupeKey: z.string().max(200).optional(),
  data: z.record(z.unknown()).default({}),
});
export type NotificationJob = z.infer<typeof notificationJobSchema>;

export interface Preferences { muted: NotificationKind[]; mutedActors: string[] }

/** Sink writes the notification row (Postgres in the API). Returns false if dedupe suppressed it. */
export interface NotificationSink {
  preferences(userId: string): Promise<Preferences>;
  insert(job: NotificationJob): Promise<boolean>;
}

export async function deliver(job: NotificationJob, sink: NotificationSink): Promise<"delivered" | "muted" | "duplicate" | "self"> {
  const j = notificationJobSchema.parse(job);
  if (j.actorId && j.actorId === j.recipientId) return "self";
  const p = await sink.preferences(j.recipientId);
  if (p.muted.includes(j.kind) || (j.actorId && p.mutedActors.includes(j.actorId))) return "muted";
  return (await sink.insert(j)) ? "delivered" : "duplicate";
}

export interface NotificationQueue {
  readonly kind: "bullmq" | "in-process";
  enqueue(job: NotificationJob): Promise<void>;
  drain(): Promise<void>;
  close(): Promise<void>;
}

/** In-process fallback for local dev or single-instance deploys when no Redis is configured. */
export class InProcessQueue implements NotificationQueue {
  readonly kind = "in-process" as const;
  private pending: Promise<unknown>[] = [];
  results: string[] = [];
  constructor(private sink: NotificationSink, private onError: (e: unknown) => void = console.error) {}
  async enqueue(job: NotificationJob) {
    const p = Promise.resolve().then(() => deliver(job, this.sink)).then((r) => this.results.push(r)).catch(this.onError);
    this.pending.push(p);
  }
  async drain() { await Promise.all(this.pending); this.pending = []; }
  async close() { await this.drain(); }
}

/** BullMQ-backed queue with retries and backoff. Used when REDIS_URL is set. */
export async function createBullQueue(redisUrl: string, sink: NotificationSink, opts: { runWorker?: boolean } = {}): Promise<NotificationQueue> {
  const { Queue, Worker } = await import("bullmq");
  const { Redis } = await import("ioredis");
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue("atlas-notifications", { connection });
  const worker = opts.runWorker === false ? null : new Worker("atlas-notifications", async (job) => deliver(job.data as NotificationJob, sink), { connection, concurrency: 8 });
  return {
    kind: "bullmq",
    async enqueue(job) {
      const j = notificationJobSchema.parse(job);
      await queue.add(j.kind, j, { attempts: 5, backoff: { type: "exponential", delay: 1000 }, removeOnComplete: 1000, removeOnFail: 5000, jobId: j.dedupeKey });
    },
    async drain() {},
    async close() { await worker?.close(); await queue.close(); connection.disconnect(); },
  };
}

export async function createQueue(sink: NotificationSink, env: { REDIS_URL?: string } = process.env): Promise<NotificationQueue> {
  return env.REDIS_URL ? createBullQueue(env.REDIS_URL, sink) : new InProcessQueue(sink);
}

/** Maps indexed chain events to notifications. Recipient lookup is supplied by the API (wallet -> user). */
export function notificationsForChainEvent(
  ev: { name: string; args: Record<string, unknown>; id: string },
  ctx: { thesisAuthorUserId?: string; actorUserId?: string },
): NotificationJob[] {
  const id = String(ev.args.thesisId ?? "");
  const map: Record<string, NotificationKind> = {
    ReviewPublished: "thesis.reviewed", EvidenceChallenged: "thesis.challenged",
    OutcomeProposed: "outcome.proposed", OutcomeChallenged: "outcome.challenged", OutcomeFinalized: "outcome.finalized",
  };
  const kind = map[ev.name];
  if (!kind || !ctx.thesisAuthorUserId) return [];
  return [{ kind, recipientId: ctx.thesisAuthorUserId, actorId: ctx.actorUserId, subjectId: id, dedupeKey: `chain:${ev.id}`, data: { event: ev.name } }];
}
