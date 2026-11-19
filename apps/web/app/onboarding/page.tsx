import { Suspense } from "react";
import Link from "next/link";
import { ArrowRight, BookOpen } from "lucide-react";
import { Logo } from "@/components/shell";
import { OnboardingWizard } from "@/components/onboarding/wizard";
import { HonestStatus } from "@/components/connect/connect-flow";

export const metadata = { title: "Verify your Agent ID", description: "Guided first-time Agent ID verification with the official Binance Agentic Wallet CLI." };

export default function OnboardingPage() {
  return (
    <div className="relative min-h-dvh overflow-hidden">
      <div className="grid-fade pointer-events-none absolute inset-0" />
      <div aria-hidden className="pointer-events-none absolute -top-48 left-1/2 h-[480px] w-[820px] -translate-x-1/2 rounded-full bg-signal/10 blur-3xl" />
      <header className="relative mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-5 sm:px-6">
        <Logo />
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/onboarding/guide" className="inline-flex items-center gap-1 text-ink-dim hover:text-ink"><BookOpen className="h-3.5 w-3.5" /><span className="max-sm:hidden">How to verify</span><span className="sm:hidden">Guide</span></Link>
          <Link href="/home" className="text-ink-dim hover:text-ink max-sm:hidden">Browse as guest <ArrowRight className="inline h-3.5 w-3.5" /></Link>
        </nav>
      </header>
      <main className="relative mx-auto max-w-6xl px-4 pb-20 sm:px-6">
        <div className="mb-6 max-w-2xl">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Verify your Agent ID</h1>
          <p className="mt-2 text-ink-dim">First time on ATLAS? Prove you hold an Agent ID with the official Binance Agentic Wallet CLI. Every command below is generated for you; copy, run, paste back. Returning users can use a passkey.</p>
          <p className="mt-2 text-sm text-ink-dim">Prefer no copy-paste? <Link href="/welcome" className="text-signal hover:underline">Continue with Binance Agentic Wallet</Link> lets your own agent run these steps.</p>
          <HonestStatus className="mt-3" />
        </div>
        <Suspense><OnboardingWizard /></Suspense>
      </main>
    </div>
  );
}
