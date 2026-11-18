import { AlertTriangle } from "lucide-react";
export function RiskWarning({ text, className = "" }: { text?: string; className?: string }) {
  return (
    <div role="note" className={`flex gap-3 rounded-2xl border border-amber-warn/25 bg-amber-warn/[0.06] p-4 text-sm text-amber-warn ${className}`}>
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <p>{text ?? "Trading digital assets is risky and you can lose money. Nothing on ATLAS is financial advice, and no returns are promised. ATLAS never holds your keys, never signs for you and never executes without your confirmation in your own wallet."}</p>
    </div>
  );
}

/** Shown wherever an on-chain action would happen while the ATLAS contracts are not yet deployed. */
export function ContractsPending({ what = "This on-chain action", className = "" }: { what?: string; className?: string }) {
  return (
    <div role="status" data-testid="contracts-pending" className={`flex gap-3 rounded-2xl border border-amber-warn/25 bg-amber-warn/[0.06] p-4 text-sm ${className}`}>
      <span aria-hidden className="mt-0.5 h-2 w-2 shrink-0 animate-pulse rounded-full bg-amber-warn" />
      <div>
        <div className="font-medium text-amber-warn">Contracts pending deployment</div>
        <p className="mt-1 text-ink-dim">{what} needs the ATLAS registries, which are not deployed on mainnet yet. Nothing has been sent or recorded on-chain. Agent ID eligibility is still checked live against the official registry.</p>
      </div>
    </div>
  );
}
