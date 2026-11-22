import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, MessageSquareText, Info, Unplug } from "lucide-react";
import { DocsShell } from "@/components/docs/docs-shell";
import { CopyCode } from "@/components/docs/copy";
import { CLIENTS, MCP_URL, STATUS_LABEL, SUPPORT_AS_OF } from "@/lib/ai-clients";

export function generateStaticParams() { return CLIENTS.map((c) => ({ client: c.slug })); }

export async function generateMetadata({ params }: { params: Promise<{ client: string }> }): Promise<Metadata> {
  const { client } = await params;
  const c = CLIENTS.find((x) => x.slug === client);
  return c ? { title: `Connect ATLAS to ${c.name}`, description: `${c.tagline} Remote MCP URL ${MCP_URL}.` } : {};
}

export default async function ClientGuidePage({ params }: { params: Promise<{ client: string }> }) {
  const { client } = await params;
  const c = CLIENTS.find((x) => x.slug === client);
  if (!c) notFound();
  const others = CLIENTS.filter((x) => x.slug !== c.slug);
  return (
    <DocsShell>
      <Link href="/docs/ai" className="mt-6 inline-flex items-center gap-1.5 text-sm text-ink-dim hover:text-ink"><ArrowLeft className="h-4 w-4" /> All AI apps</Link>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">Connect ATLAS to {c.name}</h1>
      <p className="mt-2 max-w-2xl text-ink-dim">{c.tagline}</p>
      <p className="mt-3 text-sm text-ink">{STATUS_LABEL[c.status]} · as of {SUPPORT_AS_OF}. {c.statusDetail}</p>
      {c.plan && <p className="mt-3 inline-flex items-start gap-2 rounded-xl border border-line bg-black/25 px-3 py-2 text-xs text-ink-dim"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />{c.plan}</p>}

      <ol className="mt-8 space-y-4">
        {c.steps.map((s, i) => (
          <li key={i} className="glass flex gap-4 p-5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-signal/40 bg-signal/10 text-sm font-semibold text-signal">{i + 1}</span>
            <div className="min-w-0 flex-1 text-sm text-ink">
              <p>{s.text}</p>
              {s.code && <CopyCode code={s.code} />}
            </div>
          </li>
        ))}
      </ol>

      <section className="mt-8 grid gap-4 md:grid-cols-2">
        <div className="glass p-5">
          <p className="flex items-center gap-2 text-sm font-medium text-ink"><MessageSquareText className="h-4 w-4 text-signal" /> Try it</p>
          <p className="mt-2 text-sm italic text-ink-dim">&ldquo;{c.tryPrompt}&rdquo;</p>
        </div>
        <div className="glass p-5">
          <p className="flex items-center gap-2 text-sm font-medium text-ink"><Unplug className="h-4 w-4 text-signal" /> Disconnect any time</p>
          <p className="mt-2 text-sm text-ink-dim">ATLAS Settings → Agents lists every connected app with a Disconnect button. Access stops immediately.</p>
        </div>
      </section>
      {c.notes?.map((n) => <p key={n} className="mt-4 text-sm text-ink-dim">{n}</p>)}
      <p className="mt-6 text-sm text-ink-dim">Posting: the app saves drafts first and must show you the exact text before it publishes. On-chain steps are unsigned until you confirm them in your own wallet. <Link href="/privacy" className="text-signal hover:underline">What ATLAS stores</Link>.</p>

      <div className="mt-12 flex flex-wrap gap-2">
        {others.map((o) => <Link key={o.slug} href={`/docs/ai/${o.slug}`} className="rounded-full border border-line px-3 py-1.5 text-sm text-ink-dim hover:border-line-strong hover:text-ink">{o.name}</Link>)}
      </div>
    </DocsShell>
  );
}
