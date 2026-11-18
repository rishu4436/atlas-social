import type { Q } from "../db/index.js";
import { publicProfile, thesisView, tradeProofView } from "./views.js";

/** Loads posts with author, counts, viewer state, attached thesis/proof. Runs inside db.as(viewer). */
export async function loadPosts(q: Q, viewer: string | null, where: string, params: unknown[], tail = "ORDER BY p.created_at DESC LIMIT 50") {
  const vi = params.length + 1;
  const rows = await q(
    `SELECT p.*, row_to_json(pr) AS author,
       (SELECT count(*) FROM reactions r WHERE r.post_id = p.id AND r.kind = 'like')::int AS likes,
       (SELECT count(*) FROM reactions r WHERE r.post_id = p.id AND r.kind = 'repost')::int AS reposts,
       (SELECT count(*) FROM comments c WHERE c.post_id = p.id AND c.deleted_at IS NULL AND c.moderation_status = 'visible')::int AS comments,
       EXISTS (SELECT 1 FROM reactions r WHERE r.post_id = p.id AND r.user_id = $${vi}::uuid AND r.kind = 'like') AS liked,
       EXISTS (SELECT 1 FROM reactions r WHERE r.post_id = p.id AND r.user_id = $${vi}::uuid AND r.kind = 'repost') AS reposted,
       EXISTS (SELECT 1 FROM bookmarks b WHERE b.post_id = p.id AND b.user_id = $${vi}::uuid) AS bookmarked,
       row_to_json(t) AS thesis, row_to_json(tp) AS trade_proof
     FROM posts p
     JOIN profiles pr ON pr.user_id = p.author_id
     JOIN users u ON u.id = p.author_id AND u.status = 'active'
     LEFT JOIN theses t ON t.id = p.thesis_id
     LEFT JOIN trade_proofs tp ON tp.id = p.trade_proof_id
     WHERE p.deleted_at IS NULL AND (${where}) ${tail}`,
    [...params, viewer],
  );
  const pollIds = rows.filter((r) => r.kind === "poll").map((r) => r.id);
  const votes = pollIds.length
    ? await q(`SELECT post_id, option, count(*)::int AS n, bool_or(user_id = $2::uuid) AS mine FROM poll_votes WHERE post_id = ANY($1::uuid[]) GROUP BY post_id, option`, [pollIds, viewer])
    : [];
  return rows.map((r) => postView(r, viewer, votes.filter((v) => v.post_id === r.id)));
}

export function postView(r: any, viewer: string | null, votes: any[] = []) {
  const removed = r.moderation_status === "removed";
  const isAuthor = viewer && viewer === r.author_id;
  return {
    id: r.id,
    kind: r.kind,
    author: publicProfile(r.author),
    body: removed ? "" : r.body,
    topics: r.topics,
    links: removed ? [] : r.links,
    linkWarnings: r.link_warnings,
    chart: removed ? null : r.chart,
    poll: r.poll ? { ...r.poll, results: votes.map((v) => ({ option: v.option, votes: v.n })), myVote: votes.find((v) => v.mine)?.option ?? null } : null,
    aiReport: removed ? null : r.ai_report,
    aiLabel: r.kind === "ai_research" ? "AI-generated research. Untrusted until independently validated." : null,
    media: removed ? [] : r.media,
    thesis: r.thesis ? thesisView(r.thesis, { includeSalt: !!isAuthor }) : null,
    tradeProof: r.trade_proof ? tradeProofView(r.trade_proof) : null,
    squadId: r.squad_id,
    replyTo: r.reply_to,
    repostOf: r.repost_of,
    moderation: removed
      ? {
          status: "removed",
          note: r.thesis?.publish_tx
            ? "Hidden on ATLAS by moderation. The on-chain thesis record is immutable and still exists on the blockchain; ATLAS does not claim it was deleted."
            : "Removed by ATLAS moderation.",
        }
      : r.moderation_status === "limited" ? { status: "limited", note: "Visibility limited by moderation." } : null,
    simulated: r.simulated,
    counts: { likes: r.likes, reposts: r.reposts, comments: r.comments },
    viewer: viewer ? { liked: r.liked, reposted: r.reposted, bookmarked: r.bookmarked } : null,
    createdAt: r.created_at,
  };
}

export type PostView = ReturnType<typeof postView>;

/** "For You": evidence, freshness, relationships, interests; penalises reports, risky links and author repetition. Never ranks by profit or follower count. */
export function rankForYou(posts: (PostView & { _score?: number })[], ctx: { following: Set<string>; interests: Set<string>; reports: Map<string, number>; now: number }) {
  const scored = posts.map((p) => {
    const ageH = (ctx.now - new Date(p.createdAt).getTime()) / 3.6e6;
    const fresh = Math.exp(-ageH / 36);
    const evidence = p.thesis?.chainStatus === "published" || p.thesis?.chainStatus === "committed" ? 0.6 : p.tradeProof?.status === "VERIFIED" ? 0.6 : p.kind === "ai_research" ? 0.15 : 0;
    const rel = ctx.following.has(p.author.userId) ? 0.35 : 0;
    const interest = p.topics.some((t: string) => ctx.interests.has(t)) ? 0.25 : 0;
    const quality = Math.log1p(p.counts.likes + 2 * p.counts.comments) / 6;
    const reportPenalty = Math.pow(0.5, ctx.reports.get(p.id) ?? 0);
    const linkPenalty = p.linkWarnings.length ? 0.5 : 1;
    const score = fresh * (1 + evidence + rel + interest + Math.min(quality, 0.5)) * reportPenalty * linkPenalty;
    const why = [evidence ? "verifiable evidence" : null, rel ? "you follow the author" : null, interest ? "matches your topics" : null, fresh > 0.7 ? "recent" : null].filter(Boolean) as string[];
    return { p, score, why };
  });
  scored.sort((a, b) => b.score - a.score);
  // diversity: penalise repeated authors
  const seen = new Map<string, number>();
  const out: { p: PostView; score: number; why: string[] }[] = [];
  for (const s of scored) {
    const k = seen.get(s.p.author.userId) ?? 0;
    seen.set(s.p.author.userId, k + 1);
    out.push({ ...s, score: s.score * Math.pow(0.6, k) });
  }
  out.sort((a, b) => b.score - a.score);
  return out.map((s) => ({ ...s.p, ranking: { score: Number(s.score.toFixed(4)), why: s.why } }));
}
