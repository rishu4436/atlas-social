"use client";
import { use } from "react";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { PaymentRequestCard } from "@/components/pay/request-card";

export default function RequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <div className="mx-auto max-w-md space-y-4 pt-4">
      <PaymentRequestCard id={id} />
      <p className="flex gap-2 text-xs leading-relaxed text-ink-faint"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-up" />ATLAS never pulls funds or asks for keys. If you pay, you authorize it in your own wallet after reviewing the recipient&apos;s current Agent ID owner address. Payments never change Skill Score or points. <Link href="/pay" className="text-signal hover:underline">Your receipts</Link></p>
    </div>
  );
}
