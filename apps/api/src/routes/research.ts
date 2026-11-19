import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { marketByAsset, isTokenAllowlisted } from "../lib/compat.js";
import { marketAnalyst, thesisChallenger, riskAnalyst, synthesize, narrate, scanUntrusted, type MarketContext, type ThesisContext } from "@atlas/ai-research";
import type { Deps } from "../deps.js";
import { bad, notFound, conflict } from "../lib/errors.js";
import { requireCsrf } from "../lib/session.js";
import { createPost } from "./social.js";

async function ctx(deps: Deps, asset: string): Promise<MarketContext> {
  const m = marketByAsset(asset);
  if (!m) throw bad("UNSUPPORTED_ASSET", "Unsupported market");
  const [candles, ticker] = await Promise.all([deps.market.klines(m.symbol, "1h", { limit: 300 }), deps.market.ticker24h(m.symbol)]);
  return { symbol: m.symbol, candles, ticker, source: deps.market.id, simulated: deps.market.simulated };
}

export async function researchRoutes(app: FastifyInstance, deps: Deps) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const llm = { apiKey: deps.cfg.AI_API_KEY, baseUrl: deps.cfg.AI_BASE_URL, model: deps.cfg.AI_MODEL };
  const limit = { config: { rateLimit: { max: 15, timeWindow: "1 minute" } } };

  r.post("/research/analyze", { ...limit, schema: { tags: ["research"], summary: "Market Analyst + Risk Analyst + Synthesizer brief", body: z.object({ asset: z.string().max(10), share: z.boolean().default(false) }) } }, async (req) => {
    const m = await ctx(deps, req.body.asset);
    const reps = [marketAnalyst(m), riskAnalyst(m, null, { tokenAllowlisted: isTokenAllowlisted(req.body.asset) })];
    const brief = await narrate(synthesize(reps, m), llm);
    let postId: string | null = null;
    if (req.body.share) {
      if (req.agent) throw bad("AGENT_SHARE_DISABLED", "Agents cannot post research to the feed. Use a draft thesis, review or challenge, which are labelled as agent-authored.");
      const a = requireCsrf(req);
      postId = await createPost(deps, a.userId, { kind: "ai_research", body: brief.summary.slice(0, 1000), topics: [req.body.asset.toLowerCase(), "ai"], mediaIds: [], aiReport: { brief, reports: reps } } as any);
    }
    return { brief, reports: reps, postId, llm: llm.apiKey ? "enabled" : "disabled (deterministic analysis only)" };
  });

  r.post("/research/challenge", { ...limit, schema: { tags: ["research"], summary: "Thesis Challenger: assumptions, contradictions and weaknesses", body: z.object({ thesisId: z.string().uuid().optional(), draft: z.object({ asset: z.string(), direction: z.enum(["LONG", "SHORT"]), entryPrice: z.number().positive().nullable().default(null), targetPrice: z.number().positive(), invalidationPrice: z.number().positive(), horizonHours: z.number().int().min(1).max(8760), confidence: z.number().int().min(0).max(100), text: z.string().max(20000).default("") }).optional() }) } }, async (req) => {
    let asset: string, t: ThesisContext;
    if (req.body.thesisId) {
      const viewer = req.auth?.userId ?? null;
      const [row] = await deps.db.as(viewer, (q) => q(`SELECT * FROM theses WHERE id = $1`, [req.body.thesisId]));
      if (!row) throw notFound("Thesis");
      if (row.visibility === "COMMIT_REVEAL" && row.chain_status !== "published" && row.author_id !== viewer) throw conflict("TERMS_HIDDEN", "Terms are hidden until the author reveals them");
      asset = row.asset;
      t = { direction: row.direction, entry: row.entry_price ? Number(row.entry_price) : null, target: Number(row.target_price), invalidation: Number(row.invalidation_price), horizonHours: row.horizon_hours, confidence: row.confidence, text: `${row.content.title}\n${row.content.summary}\n${row.content.body}` };
    } else if (req.body.draft) {
      asset = req.body.draft.asset;
      const d = req.body.draft;
      t = { direction: d.direction, entry: d.entryPrice, target: d.targetPrice, invalidation: d.invalidationPrice, horizonHours: d.horizonHours, confidence: d.confidence, text: d.text };
    } else throw bad("INPUT_REQUIRED", "thesisId or draft required");
    const m = await ctx(deps, asset);
    const challenge = thesisChallenger(m, t);
    const risk = riskAnalyst(m, t, { tokenAllowlisted: isTokenAllowlisted(asset) });
    const brief = await narrate(synthesize([challenge, risk], m), llm, t.text);
    return { challenge, risk, brief };
  });

  r.post("/research/explain", { ...limit, schema: { tags: ["research"], summary: "Explain a chart or summarise a discussion (untrusted text is data only)", body: z.object({ asset: z.string().max(10), text: z.string().max(20000).default("") }) } }, async (req) => {
    const m = await ctx(deps, req.body.asset);
    const scan = scanUntrusted(req.body.text);
    const report = await narrate(marketAnalyst(m), llm, req.body.text || undefined);
    return { report: { ...report, flags: [...report.flags, ...(scan.flagged ? ["prompt-injection-detected", ...scan.reasons] : [])] }, untrustedInputScan: scan };
  });
}
