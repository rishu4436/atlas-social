"use client";
import { use } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { CheckCircle2, XCircle, HelpCircle, ArrowLeft, Boxes } from "lucide-react";
import { Card, Badge, Skeleton, StaggerList, StaggerItem, CommittedBadge } from "@atlas/design-system";
import { useApi, short } from "@/lib/api";
import { CopyBlock } from "@/components/tx-panel";

export default function Proof({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const p = useApi<any>(`/theses/${id}/proofs`);
  if (p.error) return <Card className="p-10 text-center text-ink-dim">Proof bundle unavailable.</Card>;
  if (!p.data) return <div className="space-y-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}</div>;
  const d = p.data;
  const passed = d.checks.filter((c: any) => c.ok === true).length;
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link href={`/thesis/${id}`} className="inline-flex items-center gap-1 text-sm text-ink-dim hover:text-ink"><ArrowLeft className="h-4 w-4" />Back to thesis</Link>
      <Card hover={false} glow className="flex flex-wrap items-center justify-between gap-4 p-6">
        <div><h1 className="text-2xl font-semibold">Independent verification</h1><p className="mt-1 text-sm text-ink-dim">Recomputed by ATLAS from public data. You can reproduce every check below yourself.</p></div>
        <div className="text-right"><div className="num text-3xl font-semibold text-signal">{passed}/{d.checks.length}</div><div className="label">checks passed</div></div>
      </Card>
      <StaggerList className="space-y-2" gap={0.08}>
        {d.checks.map((c: any) => (
          <StaggerItem key={c.name}><Card className="flex items-start gap-3 p-4">
            <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 500, damping: 20, delay: 0.1 }}>
              {c.ok === true ? <CheckCircle2 className="h-5 w-5 text-emerald-up" /> : c.ok === false ? <XCircle className="h-5 w-5 text-coral-down" /> : <HelpCircle className="h-5 w-5 text-amber-warn" />}
            </motion.span>
            <div className="min-w-0"><div className="font-medium">{c.name}</div><div className="hash break-all text-xs text-ink-dim">{c.detail}</div></div>
          </Card></StaggerItem>
        ))}
      </StaggerList>
      <Card hover={false} className="grid gap-3 p-5 sm:grid-cols-2">
        <CopyBlock label="commitment" text={d.commitment} />
        <CopyBlock label={`registry · chain ${d.chainId}`} text={d.registry} />
        {d.publishTx && <CopyBlock label="publish transaction" text={d.publishTx} />}
        {d.onchainId && <CopyBlock label="on-chain id" text={String(d.onchainId)} />}
      </Card>
      <Card hover={false} className="p-5">
        <div className="label mb-3 flex items-center gap-1.5"><Boxes className="h-3.5 w-3.5" />Indexed events</div>
        <ol className="relative space-y-4 border-l border-line pl-5">
          {d.events.map((e: any, i: number) => (
            <motion.li key={i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.06 }} className="relative">
              <span className="absolute -left-[26px] top-1 h-3 w-3 rounded-full border-2 border-signal bg-obsidian" />
              <div className="flex items-center gap-2"><span className="font-medium">{e.name}</span><Badge tone={e.status === "final" ? "up" : "warn"}>{e.status}</Badge></div>
              <div className="hash text-[11px] text-ink-faint">block {e.block_number} · {e.txUrl ? <a className="underline" href={e.txUrl} target="_blank" rel="noreferrer">{short(e.tx_hash, 8)}</a> : short(e.tx_hash, 8)}</div>
            </motion.li>
          ))}
          {d.events.length === 0 && <li className="text-sm text-ink-dim">No events indexed yet.</li>}
        </ol>
      </Card>
      <Card hover={false} className="grid gap-3 p-5 sm:grid-cols-3">
        {[["Prediction", d.separation.prediction], ["Outcome", d.separation.outcome], ["Execution", d.separation.execution]].map(([k, v]) => (
          <div key={k}><div className="label">{k}</div><p className="mt-1 text-sm text-ink-dim">{v}</p></div>
        ))}
      </Card>
      {d.evidence && <Card hover={false} className="p-5"><div className="label mb-2">Outcome evidence · <span className="hash">{short(d.evidenceHash, 8)}</span></div><pre className="hash max-h-72 overflow-auto text-[11px] text-ink-dim">{JSON.stringify(d.evidence, null, 2)}</pre></Card>}
      <Card hover={false} className="p-5"><div className="label mb-2">Methodology {d.methodology.id} v{d.methodology.version}</div>
        <dl className="grid gap-2 text-sm">{Object.entries(d.methodology).filter(([k]) => !["id", "version"].includes(k)).map(([k, v]) => <div key={k}><dt className="text-ink-faint">{k}</dt><dd className="text-ink-dim">{String(v)}</dd></div>)}</dl>
      </Card>
      {d.publishTx && <div className="flex justify-center"><CommittedBadge reveal={false} /></div>}
    </div>
  );
}
