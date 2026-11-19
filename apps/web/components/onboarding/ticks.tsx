import * as React from "react";

/** Renders `backticked` spans in catalog text as inline code. */
export function Ticks({ text }: { text: string }) {
  const parts = text.split("`");
  return <>{parts.map((p, i) => (i % 2 ? <code key={i} className="rounded bg-black/30 px-1 py-0.5 text-[0.9em] text-ink">{p}</code> : <React.Fragment key={i}>{p}</React.Fragment>))}</>;
}
