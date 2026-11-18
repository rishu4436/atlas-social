"use client";
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Sparkles, LineChart, Swords, ShieldAlert, Layers, ScanSearch, Share2 } from "lucide-react";
import { Card, Button, Badge, Tabs, StaggerList, StaggerItem, Skeleton, cx } from "@atlas/design-system";
import { api, useSession, useApi } from "@/lib/api";
import { useToast } from "@/components/providers";

const AGENTS = [
  { i: LineChart, n: "Market Analyst", d: "Trend, momentum, volatility and key levels from public candles." },
  { i: Swords, n: "Thesis Challenger", d: "Hunts weak assumptions, contradictions and missing invalidation." },
  { i: ShieldAlert, n: "Risk Analyst", d: "Drawdown, liquidity, token allowlist and execution risks." },
  { i: Layers, n: "Research Synthesizer", d: "Combines reports into a cited brief with explicit uncertainty." },
];

export default function AI() {
  const { authed } = useSession();
  const toast = useToast();
  const cfg = useApi<any>("/config");
  const [mode, setMode] = useState<"analyze" | "explain">("analyze");
  const [asset, setAsset] = useState("BNB");
  const [text, setText] = useState("");
  const [res, setRes] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const run = async (share = false) => {
    setBusy(true); setRes(null);
    try { setRes(mode === "analyze" ? await api("/research/analyze", { body: { asset, share } }) : await api("/research/explain", { body: { asset, text } })); if (share) toast({ kind: "ok", text: "Shared to your feed, labelled as AI research" }); }
    catch (e: any) { toast({ kind: "err", text: e.message }); } finally { setBusy(false); }
  };
  const auto = useRef(false);
  // run one deterministic BNB brief on first visit so the desk never opens empty
  useEffect(() => { if (!auto.current) { auto.current = true; run(false); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const report = res?.brief ?? res?.report;
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div><h1 className="text-2xl font-semibold">AI Research Desk</h1><p className="text-sm text-ink-dim">Four specialist agents. They research only: they cannot sign, approve, transfer or execute anything.</p></div>
      <StaggerList className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{AGENTS.map((a) => (
        <StaggerItem key={a.n}><Card className="h-full p-4"><a.i className="h-5 w-5 text-[#c4b5fd]" /><div className="mt-2 text-sm font-semibold">{a.n}</div><p className="mt-1 text-xs text-ink-dim">{a.d}</p></Card></StaggerItem>
      ))}</StaggerList>
      <Card hover={false} className="space-y-4 p-5">
        <Tabs id="ai-mode" value={mode} onChange={setMode} tabs={[{ value: "analyze", label: <span className="inline-flex items-center gap-1.5"><Sparkles className="h-3.5 w-3.5" />Analyze market</span> }, { value: "explain", label: <span className="inline-flex items-center gap-1.5"><ScanSearch className="h-3.5 w-3.5" />Check a claim</span> }]} />
        <div className="flex flex-wrap gap-2">{["BNB", "BTC", "ETH", "CAKE"].map((a) => <button key={a} onClick={() => setAsset(a)} className={cx("rounded-xl border px-3 py-1.5 text-sm", asset === a ? "border-signal/50 bg-signal-dim" : "border-line text-ink-dim")}>{a}</button>)}</div>
        <AnimatePresence>{mode === "explain" && <motion.textarea initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="input min-h-24" placeholder="Paste a post or claim. It is treated as untrusted input and scanned for injected instructions." value={text} onChange={(e) => setText(e.target.value)} />}</AnimatePresence>
        <div className="flex gap-2">
          <Button loading={busy} disabled={mode === "explain" && !text.trim()} onClick={() => run(false)}><Sparkles className="h-4 w-4" />Run</Button>
          {mode === "analyze" && authed && <Button variant="outline" disabled={busy} onClick={() => run(true)}><Share2 className="h-4 w-4" />Run & share</Button>}
        </div>
        <p className="text-[11px] text-ink-faint">LLM narration: {cfg.data?.ai?.llm ? "enabled (schema-validated)" : "off: deterministic indicators only"}. Untrusted text is wrapped and never treated as instructions.</p>
      </Card>
      {busy && <Skeleton className="h-48" />}
      <AnimatePresence>{report && (
        <Card hover={false} glow className="space-y-4 p-5" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}>
          <div className="flex flex-wrap items-center gap-2"><Badge tone="ai"><Sparkles className="h-3 w-3" />{report.title ?? report.agent}</Badge>{report.flags?.map((f: string) => <Badge key={f} tone="warn">{f}</Badge>)}<span className="num ml-auto text-xs text-ink-faint">confidence {report.confidence}/100</span></div>
          <motion.div className="h-1.5 overflow-hidden rounded-full bg-white/5"><motion.div className="h-full origin-left rounded-full bg-gradient-to-r from-signal to-[#c4b5fd]" initial={{ scaleX: 0 }} animate={{ scaleX: report.confidence / 100 }} transition={{ type: "spring", stiffness: 80, damping: 20 }} /></motion.div>
          <p>{report.summary}</p>
          <StaggerList className="grid gap-2 sm:grid-cols-2">{report.findings.map((f: any, i: number) => <StaggerItem key={i} className="rounded-xl bg-black/25 p-3 text-sm"><b className="font-medium">{f.claim}</b><span className="block text-xs text-ink-faint">{f.evidence}</span></StaggerItem>)}</StaggerList>
          <p className="text-xs text-ink-dim">{report.uncertainty}</p>
          {res.untrustedInputScan?.flagged && <p className="text-xs text-amber-warn">Injected instructions detected and ignored: {res.untrustedInputScan.reasons.join(", ")}</p>}
          <p className="text-[11px] text-ink-faint">{report.disclaimer}</p>
        </Card>
      )}</AnimatePresence>
    </div>
  );
}
