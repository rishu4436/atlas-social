import Link from "next/link";
import { ArrowRight, ShieldCheck, Terminal, Fingerprint, Link2, CheckCircle2, ExternalLink, Gavel } from "lucide-react";
import { AUTH_ERRORS } from "@atlas/auth/onboarding";
import { Logo } from "@/components/shell";

export const metadata = { title: "How to verify Agent ID sign-in", description: "Judge and tester guide for ATLAS Agent ID onboarding: what to run, what to check, and every error explained." };

const REPO = "https://github.com/rishu4436/atlas-social";
const AGENT_ID_REGISTRY = "0x60b9262456de011f7d15a54cdd8c48baaa8b022f";

const controls: [string, string][] = [
  ["EIP-712 typed message", "Domain \"ATLAS Social\", primaryType AtlasLogin, chain-bound. The statement says it authorizes no transaction, transfer or approval."],
  ["Website binding", "The message carries the ATLAS origin (audience). A signature made for a phishing site is rejected here."],
  ["Single-use nonce", "32 random bytes per challenge, stored server-side. Replays return ALREADY_USED."],
  ["5-minute expiry", "Visible countdown. Expired or regenerated challenges are marked stale and refused by the API."],
  ["Failed attempts burn the challenge", "A rejected signature can't be retried against the same challenge."],
  ["Signer check", "ecrecover for normal wallets; ERC-1271/6492 for smart-contract wallets."],
  ["Live Agent ID check", `Ownership is read from the official Agent ID registry on BSC (${AGENT_ID_REGISTRY.slice(0, 10)}…) at challenge and at verify time.`],
  ["One Agent ID ↔ one account", "A second wallet presenting the same Agent ID, or a wallet linked to another Agent ID, is refused."],
  ["Rate limit", "20 sign-in attempts per minute per address."],
  ["No QR or pairing login on ATLAS", "Sign-in is a signature from your own wallet CLI. Nothing on ATLAS asks for a seed phrase, key, QR or pairing code."],
  ["Passkeys are social-only", "Financial and on-chain actions always need a fresh wallet proof (10 minutes)."],
];

export default function GuidePage() {
  const errors = Object.entries(AUTH_ERRORS);
  return (
    <div className="relative min-h-dvh overflow-hidden">
      <div className="grid-fade pointer-events-none absolute inset-0" />
      <header className="relative mx-auto flex max-w-5xl items-center justify-between px-4 py-5 sm:px-6">
        <Logo />
        <Link href="/onboarding" className="inline-flex items-center gap-1 text-sm text-signal hover:underline">Open the wizard <ArrowRight className="h-3.5 w-3.5" /></Link>
      </header>
      <main className="relative mx-auto max-w-5xl space-y-10 px-4 pb-24 sm:px-6">
        <section>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-signal/30 bg-signal-dim px-2.5 py-1 text-[11px] font-medium text-signal"><Gavel className="h-3 w-3" />For judges and testers</span>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-5xl">How to verify Agent ID sign-in</h1>
          <p className="mt-3 max-w-2xl text-ink-dim">ATLAS uses the official Binance Agentic Wallet CLI (<code>baw</code>) for first-time Agent ID verification and passkeys for returning users. Here is what to run, what to check, and what every error means.</p>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          {[
            { i: Terminal, t: "1 · Prove it with baw", d: "The wizard generates exact preview → execute → result commands from your own live challenge. You run them; ATLAS never does." },
            { i: Link2, t: "2 · Fallback on-chain", d: "If signing fails (e.g. Agentic Wallet bug #400 / 953004), send one registerIdentity transaction instead. Shown as \"Contracts pending deployment\" until the registry is live." },
            { i: Fingerprint, t: "3 · Passkey next time", d: "After verifying, add a passkey for one-tap social sign-in. Wallet proof is still required for anything financial." },
          ].map((c) => (
            <div key={c.t} className="glass p-5"><c.i className="h-5 w-5 text-signal" /><div className="mt-2 font-semibold">{c.t}</div><p className="mt-1 text-sm text-ink-dim">{c.d}</p></div>
          ))}
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <div className="glass p-6">
            <h2 className="text-lg font-semibold">With a real Agent ID (about 5 minutes)</h2>
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-ink-dim">
              <li>Install the CLI: <code>npm i -g @binance/agentic-wallet</code>, and connect it to your own wallet (<code>baw wallet status --json</code>).</li>
              <li>Check <code>baw wallet agent-id --json</code> shows <code>claimed: true</code>, and Developer Mode is on (<code>baw wallet settings --json</code>).</li>
              <li>Open <Link className="text-signal hover:underline" href="/onboarding">/onboarding</Link>, enter your wallet, pick your shell (macOS/Linux, PowerShell 7+, or Command Prompt).</li>
              <li>Copy the preview command. In its output, check domain <b>ATLAS Social</b>, your wallet, the ATLAS audience, a loginId matching the page, and <b>no</b> Permit/spender/amounts. Paste the output back.</li>
              <li>Copy the generated execute command (it now contains your requestId). Approve in the Binance App if asked, run the result command, paste the output. The signature fills in automatically.</li>
              <li>Press <b>Verify signature</b>. Expect "Agent ID verified" and an offer to add a passkey.</li>
              <li>Optional negatives: wait for the countdown to hit 0 (commands go stale, verify is refused), or paste an old signature (refused).</li>
            </ol>
          </div>
          <div className="glass p-6">
            <h2 className="text-lg font-semibold">Without an Agent ID (about 2 minutes)</h2>
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-ink-dim">
              <li>On <Link className="text-signal hover:underline" href="/onboarding">/onboarding</Link>, enter any wallet without an Agent ID. ATLAS checks the official registry live and refuses it with <code>NOT_AGENT_ID_HOLDER</code>. No account is created.</li>
              <li>Read the error catalog the UI uses: <a className="text-signal hover:underline" href="/api/auth/errors">/api/auth/errors</a>. Every code has a message, a fix and a next action.</li>
              <li>Check honesty about contracts: <a className="text-signal hover:underline" href="/api/config">/api/config</a> shows <code>contractsDeployed</code>. While it is false, the on-chain path says "Contracts pending deployment" and offers no fake success.</li>
              <li>Browse the API contract at <code>/docs</code> on the API host (OpenAPI), and the tests in the <a className="text-signal hover:underline" href={REPO}>public repo</a> (<code>apps/api/test/onboarding.test.ts</code>, <code>packages/auth/test/onboarding.test.ts</code>, <code>tests/e2e/onboarding.spec.ts</code>).</li>
            </ol>
          </div>
        </section>

        <section className="glass p-6">
          <h2 className="text-lg font-semibold">What counts toward "30 Agent ID addresses interacting"</h2>
          <p className="mt-2 text-sm text-ink-dim">Only on-chain transactions from an Agent ID holder to an ATLAS contract: <code>registerIdentity</code> (the fallback, or the Home "Anchor your Agent ID" card), publishing a thesis or review. A signature-only login is <b>not</b> an on-chain interaction, and ATLAS doesn't present it as one.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">Security controls (unchanged by the wizard)</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {controls.map(([t, d]) => (
              <div key={t} className="flex gap-3 rounded-2xl border border-line bg-white/[0.02] p-4"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-up" /><div><div className="text-sm font-semibold">{t}</div><p className="mt-0.5 text-xs text-ink-dim">{d}</p></div></div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-lg font-semibold">Every error, explained</h2>
          <p className="mt-1 text-sm text-ink-dim">The same catalog drives the wizard, so what you see here is what users see. Codes marked <b>→ on-chain</b> send the user to the guided registerIdentity fallback.</p>
          <div className="mt-3 overflow-x-auto rounded-2xl border border-line">
            <table className="w-full min-w-[640px] text-left text-sm" data-testid="error-table">
              <thead className="bg-white/[0.03] text-xs uppercase tracking-wider text-ink-faint"><tr><th className="p-3">Code</th><th className="p-3">What it means</th><th className="p-3">Fix</th></tr></thead>
              <tbody>
                {errors.map(([code, e]) => (
                  <tr key={code} className="border-t border-line align-top">
                    <td className="p-3"><code className="text-xs text-ink">{code}</code>{e.fallback && <div className="mt-1 text-[10px] font-medium text-signal">→ on-chain</div>}</td>
                    <td className="p-3"><div className="font-medium">{e.title}</div><div className="text-xs text-ink-dim">{e.message}</div></td>
                    <td className="p-3 text-xs text-ink-dim">{e.fix}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="flex flex-wrap gap-4 text-sm">
          <a className="inline-flex items-center gap-1 text-signal hover:underline" href={`${REPO}/blob/main/docs/runbooks/agent-id-signin-test.md`}>Full test runbook <ExternalLink className="h-3.5 w-3.5" /></a>
          <a className="inline-flex items-center gap-1 text-signal hover:underline" href={`${REPO}/blob/main/docs/hackathon/TESTER-ONBOARDING.md`}>Tester onboarding <ExternalLink className="h-3.5 w-3.5" /></a>
          <Link className="inline-flex items-center gap-1 text-signal hover:underline" href="/onboarding"><CheckCircle2 className="h-3.5 w-3.5" />Start verification</Link>
        </section>
      </main>
    </div>
  );
}
