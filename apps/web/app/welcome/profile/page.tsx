"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { ArrowRight, Sparkles } from "lucide-react";
import { Button, Card, Badge, Skeleton } from "@atlas/design-system";
import { api, refresh, useApi, useSession } from "@/lib/api";
import { Logo } from "@/components/shell";
import { useToast } from "@/components/providers";
import { IdentityStates } from "@/components/connect/identity-states";

const TOPICS = ["bnb", "btc", "eth", "defi", "macro", "onchain", "memes", "ai"];

/** First-run profile setup after ATLAS Connect creates an account. */
export default function ProfileSetup() {
  const router = useRouter();
  const toast = useToast();
  const { session, isLoading } = useSession();
  const me = useApi<any>(session?.authenticated ? "/profiles/me" : null);
  const [f, setF] = useState<{ displayName: string; bio: string; topics: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!isLoading && session && !session.authenticated) router.replace("/welcome"); }, [isLoading, session, router]);
  useEffect(() => { if (me.data && !f) setF({ displayName: me.data.displayName ?? "", bio: me.data.bio ?? "", topics: me.data.topics ?? [] }); }, [me.data, f]);
  const save = async () => {
    setBusy(true);
    try {
      await api("/profiles/me", { method: "PATCH", body: { displayName: f!.displayName || undefined, bio: f!.bio, topics: f!.topics } });
      await refresh("/auth/session");
      toast({ kind: "ok", text: "Profile saved" });
      router.push("/home");
    } catch (e: any) { toast({ kind: "err", text: e.message }); } finally { setBusy(false); }
  };
  return (
    <div className="relative min-h-dvh overflow-hidden">
      <div className="grid-fade pointer-events-none absolute inset-0" />
      <div aria-hidden className="pointer-events-none absolute -top-48 left-1/2 h-[480px] w-[820px] -translate-x-1/2 rounded-full bg-signal/10 blur-3xl" />
      <header className="relative mx-auto flex max-w-3xl items-center justify-between px-4 py-5 sm:px-6"><Logo /></header>
      <main className="relative mx-auto max-w-3xl space-y-6 px-4 pb-20 sm:px-6">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <Badge tone="up"><Sparkles className="h-3 w-3" />Account created</Badge>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Set up your profile{session?.profile?.agentName ? <>, <span className="text-signal">{session.profile.agentName}</span></> : null}</h1>
          <p className="mt-2 text-ink-dim">Your Agent ID is your account. Add how people see you; you can change this any time in Settings.</p>
        </motion.div>
        {session?.states && <IdentityStates states={session.states} />}
        <Card hover={false} className="space-y-4 p-5 sm:p-6">
          {!f ? <Skeleton className="h-56" /> : (<>
            <div><label className="label" htmlFor="dn">Display name</label><input id="dn" className="input mt-1" maxLength={50} value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} /></div>
            <div><label className="label" htmlFor="bio">Bio</label><textarea id="bio" className="input mt-1" rows={3} maxLength={300} placeholder="What do you research? Which markets?" value={f.bio} onChange={(e) => setF({ ...f, bio: e.target.value })} /></div>
            <div>
              <div className="label">Topics</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {TOPICS.map((t) => { const on = f.topics.includes(t); return (
                  <motion.button key={t} type="button" whileTap={{ scale: 0.94 }} aria-pressed={on} onClick={() => setF({ ...f, topics: on ? f.topics.filter((x) => x !== t) : [...f.topics, t] })}
                    className={on ? "rounded-full border border-signal/50 bg-signal/15 px-3 py-1 text-sm text-signal" : "rounded-full border border-line px-3 py-1 text-sm text-ink-dim hover:text-ink"}>#{t}</motion.button>
                ); })}
              </div>
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button loading={busy} onClick={save}>Save and continue<ArrowRight className="h-4 w-4" /></Button>
              <Button variant="ghost" onClick={() => router.push("/home")}>Skip for now</Button>
            </div>
          </>)}
        </Card>
      </main>
    </div>
  );
}
