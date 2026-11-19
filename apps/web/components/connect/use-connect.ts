"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ConnectIntentView, HandoffTexts } from "@atlas/auth/connect";
import { api, ApiError } from "@/lib/api";

export type Created = { intentId: string; code: string; purpose: "login" | "step-up" | "pay"; expiresAt: number; serverNow: number; ttlSeconds: number; handoff: HandoffTexts; payment?: any };

const TERMINAL = new Set(["redeemed", "failed", "cancelled", "expired"]);

/**
 * Browser side of ATLAS Connect: create an intent (the API sets the httpOnly browser-binding cookie), poll it, redeem it.
 * The verifier never touches JavaScript; polling and redeem work only from this browser.
 */
export function useConnect(opts: { purpose: "login" | "step-up"; pollMs?: number } | { purpose: "pay"; create: () => Promise<Created>; pollMs?: number }) {
  const [created, setCreated] = useState<Created | null>(null);
  const [view, setView] = useState<ConnectIntentView | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const skew = useRef(0);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const start = useCallback(async () => {
    setBusy(true); setError(null); setView(null);
    try {
      const o = optsRef.current;
      const c: Created = o.purpose === "pay" ? await o.create() : await api("/auth/connect/intents", { body: { purpose: o.purpose } });
      skew.current = c.serverNow - Math.floor(Date.now() / 1000);
      setCreated(c);
      setView({ intentId: c.intentId, purpose: c.purpose, status: "pending", stage: null, stageDetail: null, agentName: null, wallet: null, expiresAt: c.expiresAt, serverNow: c.serverNow });
    } catch (e: any) { setError(e); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => {
    if (!created || (view && TERMINAL.has(view.status))) return;
    let alive = true;
    const t = setInterval(async () => {
      try {
        const v = await api<ConnectIntentView>(`/auth/connect/intents/${created.intentId}`);
        if (alive) setView(v);
      } catch (e: any) { if (alive && e instanceof ApiError && e.status >= 400 && e.status < 500) { setError(e); clearInterval(t); } }
    }, opts.pollMs ?? 1500);
    return () => { alive = false; clearInterval(t); };
  }, [created, view?.status, opts.pollMs]);

  const redeem = useCallback(async () => {
    if (!created || !view?.agentName) return null;
    setBusy(true); setError(null);
    try {
      const r = await api<any>(`/auth/connect/intents/${created.intentId}/redeem`, { body: { confirmAgentName: view.agentName } });
      setView((v) => (v ? { ...v, status: "redeemed" } : v)); // stops polling (the browser cookie is now cleared)
      return r;
    }
    catch (e: any) { setError(e); return null; }
    finally { setBusy(false); }
  }, [created, view?.agentName]);

  const cancel = useCallback(async () => {
    if (created) await api(`/auth/connect/intents/${created.intentId}/cancel`, { body: {} }).catch(() => {});
    setCreated(null); setView(null); setError(null);
  }, [created]);

  return { created, view, error, busy, start, redeem, cancel, skew: skew.current, setError };
}
