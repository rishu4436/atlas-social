"use client";
import { useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "motion/react";
import { Plus, Users } from "lucide-react";
import { Card, Button, Badge, Skeleton, StaggerList, StaggerItem, Modal } from "@atlas/design-system";
import { api, useApi, useSession } from "@/lib/api";
import { useToast } from "@/components/providers";

export default function Squads() {
  const { authed } = useSession();
  const s = useApi<any[]>("/squads");
  const [open, setOpen] = useState(false);
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex items-end justify-between">
        <div><h1 className="text-2xl font-semibold">Squads</h1><p className="text-sm text-ink-dim">Research groups with shared watchlists and thesis competitions. No pooled funds, ever.</p></div>
        {authed && <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" />New squad</Button>}
      </div>
      {!s.data ? <div className="grid gap-3 sm:grid-cols-2">{[0, 1].map((i) => <Skeleton key={i} className="h-36" />)}</div> : (
        <StaggerList className="grid gap-3 sm:grid-cols-2">{s.data.map((x) => (
          <StaggerItem key={x.id}><Link href={`/squads/${x.slug}`}><Card className="h-full p-5">
            <div className="flex items-center justify-between"><div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-signal/30 to-emerald-up/20 text-signal"><Users className="h-5 w-5" /></div>{x.joined && <Badge tone="signal">Joined</Badge>}</div>
            <h2 className="mt-3 font-semibold">{x.name}</h2><p className="mt-1 line-clamp-2 text-sm text-ink-dim">{x.description}</p>
            <div className="mt-3 flex flex-wrap gap-1.5"><Badge>{x.members} members</Badge>{x.topics.map((t: string) => <Badge key={t}>#{t}</Badge>)}</div>
          </Card></Link></StaggerItem>
        ))}</StaggerList>
      )}
      <CreateSquad open={open} onClose={() => setOpen(false)} onDone={() => s.mutate()} />
    </div>
  );
}
function CreateSquad({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ name: "", slug: "", description: "", topics: "" });
  const [busy, setBusy] = useState(false);
  return (
    <Modal open={open} onClose={onClose} title="Create a squad">
      <div className="space-y-3">
        <input className="input" placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value, slug: e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) })} />
        <input className="input hash" placeholder="slug" value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value })} />
        <textarea className="input" placeholder="What does this squad research?" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        <input className="input" placeholder="topics, comma separated" value={f.topics} onChange={(e) => setF({ ...f, topics: e.target.value })} />
        <Button className="w-full" loading={busy} disabled={f.name.length < 3 || f.slug.length < 3} onClick={async () => { setBusy(true); try { await api("/squads", { body: { ...f, topics: f.topics.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean) } }); toast({ kind: "ok", text: "Squad created" }); onDone(); onClose(); } catch (e: any) { toast({ kind: "err", text: e.message }); } finally { setBusy(false); } }}>Create</Button>
      </div>
    </Modal>
  );
}
