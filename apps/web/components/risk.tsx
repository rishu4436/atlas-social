import { AlertTriangle } from "lucide-react";
export function RiskWarning({ text, className = "" }: { text?: string; className?: string }) {
  return (
    <div role="note" className={`flex gap-3 rounded-2xl border border-amber-warn/25 bg-amber-warn/[0.06] p-4 text-sm text-amber-warn ${className}`}>
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <p>{text ?? "Trading digital assets is risky and you can lose money. Nothing on ATLAS is financial advice, and no returns are promised. ATLAS never holds your keys, never signs for you and never executes without your confirmation in your own wallet."}</p>
    </div>
  );
}
