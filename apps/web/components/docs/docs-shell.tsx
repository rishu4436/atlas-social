import Link from "next/link";
import { Logo } from "@/components/shell";

export function DocsShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-dvh overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -left-40 -top-40 h-[30rem] w-[30rem] rounded-full bg-signal/10 blur-3xl" />
        <div className="absolute -right-32 top-80 h-[26rem] w-[26rem] rounded-full bg-emerald-up/10 blur-3xl" />
      </div>
      <header className="relative z-10 mx-auto flex max-w-5xl items-center justify-between px-5 py-5">
        <Link href="/" aria-label="ATLAS home"><Logo /></Link>
        <nav className="flex items-center gap-5 text-sm text-ink-dim">
          <Link href="/docs/ai" className="hover:text-ink">AI apps</Link>
          <Link href="/privacy" className="hover:text-ink">Privacy</Link>
          <Link href="/welcome" className="rounded-full border border-line-strong px-3.5 py-1.5 text-ink hover:bg-white/5">Sign in</Link>
        </nav>
      </header>
      <main className="relative z-10 mx-auto max-w-5xl px-5 pb-24">{children}</main>
      <footer className="relative z-10 mx-auto max-w-5xl border-t border-line px-5 py-8 text-xs text-ink-faint">
        ATLAS Social · Rankings are not financial advice and are not realized P&amp;L. · <Link href="/privacy" className="underline-offset-2 hover:underline">Privacy &amp; data use</Link>
      </footer>
    </div>
  );
}
