"use client";
import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cx } from "@atlas/design-system";

export function CopyCode({ code, className }: { code: string; className?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <div className={cx("group relative mt-2 overflow-hidden rounded-xl border border-line bg-black/40", className)}>
      <pre className="overflow-x-auto px-4 py-3 pr-12 font-mono text-[13px] leading-relaxed text-ink"><code>{code}</code></pre>
      <button type="button" aria-label="Copy" onClick={async () => { try { await navigator.clipboard.writeText(code); setOk(true); setTimeout(() => setOk(false), 1600); } catch { /* clipboard blocked */ } }}
        className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-lg border border-line bg-panel/80 text-ink-dim transition hover:text-ink">
        {ok ? <Check className="h-4 w-4 text-emerald-up" /> : <Copy className="h-4 w-4" />}
      </button>
    </div>
  );
}
