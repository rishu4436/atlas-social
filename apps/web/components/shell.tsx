"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { Home, Compass, LineChart, Users, Sparkles, Trophy, Bell, MessageSquare, Settings, PenSquare, User, Shield, LogIn } from "lucide-react";
import { Avatar, Button, Badge, cx, spring } from "@atlas/design-system";
import { useApi, useSession } from "@/lib/api";
import { RightPanel } from "./right-panel";

const NAV = [
  { href: "/home", label: "Home", icon: Home },
  { href: "/explore", label: "Explore", icon: Compass },
  { href: "/markets", label: "Markets", icon: LineChart },
  { href: "/squads", label: "Squads", icon: Users },
  { href: "/ai", label: "AI Research", icon: Sparkles },
  { href: "/performance", label: "Performance", icon: Trophy },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/messages", label: "Messages", icon: MessageSquare },
  { href: "/settings", label: "Settings", icon: Settings },
];
const MOBILE = [NAV[0]!, NAV[1]!, { href: "/compose", label: "Post", icon: PenSquare }, NAV[2]!, NAV[6]!];

export function Logo({ className }: { className?: string }) {
  // unique gradient id per instance: a hidden duplicate (display:none) would otherwise break url(#id) refs
  const gid = `lg-${React.useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <span className={cx("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden>
        <defs><linearGradient id={gid} x1="0" x2="1" y1="0" y2="1"><stop offset="0" stopColor="#46E1DF" /><stop offset="1" stopColor="#34D399" /></linearGradient></defs>
        <path d="M16 3 L29 27 H3 Z" fill="none" stroke={`url(#${gid})`} strokeWidth="2.4" strokeLinejoin="round" />
        <path d="M9.5 19.5 H22.5" stroke={`url(#${gid})`} strokeWidth="2.4" strokeLinecap="round" />
        <circle cx="16" cy="12" r="2" fill="#46E1DF" />
      </svg>
      <span className="text-[17px]">ATLAS</span>
    </span>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { session, authed } = useSession();
  const cfg = useApi<any>("/config");
  const unread = useApi<any[]>(authed ? "/notifications?unread=true" : null, { refreshInterval: 30_000 });
  const bare = path === "/welcome" || path === "/";
  const isAdmin = session?.roles?.includes("moderator") || session?.roles?.includes("admin");

  return (
    <div className="aurora min-h-dvh">
      {cfg.data?.agentIdIsMock && (
        <div className="sticky top-0 z-40 border-b border-amber-warn/20 bg-amber-warn/10 px-4 py-1.5 text-center text-xs text-amber-warn">
          Development mode: local chain {cfg.data.chainId} with a labelled mock Agent ID registry. Production uses the official Agent ID on BNB Smart Chain.
        </div>
      )}
      {bare ? children : (
        <div className="mx-auto flex max-w-[1320px] gap-6 px-3 lg:px-6">
          <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col py-6 lg:flex">
            <Link href="/home" className="mb-8 px-3"><Logo /></Link>
            <nav className="flex flex-col gap-0.5" aria-label="Main">
              {NAV.map((n) => {
                const active = path === n.href || path.startsWith(n.href + "/");
                return (
                  <Link key={n.href} href={n.href} className={cx("relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] transition-colors", active ? "text-ink" : "text-ink-dim hover:text-ink")}>
                    {active && <motion.span layoutId="nav-active" transition={spring} className="absolute inset-0 -z-10 rounded-xl bg-white/[0.06] shadow-[inset_0_0_0_1px_rgb(70_225_223/.18)]" />}
                    <n.icon className={cx("h-[18px] w-[18px]", active && "text-signal")} />
                    {n.label}
                    {n.href === "/notifications" && (unread.data?.length ?? 0) > 0 && <span className="ml-auto rounded-full bg-signal px-1.5 text-[10px] font-bold text-obsidian">{unread.data!.length}</span>}
                  </Link>
                );
              })}
              {isAdmin && <Link href="/admin" className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] text-ink-dim hover:text-ink"><Shield className="h-[18px] w-[18px]" />Moderation</Link>}
            </nav>
            <Link href="/compose" className="mt-6"><Button className="w-full" size="lg"><PenSquare className="h-4 w-4" />Compose</Button></Link>
            <div className="mt-auto">
              {authed && session.profile ? (
                <Link href={`/u/${session.profile.agentName}`} className="glass glass-hover flex items-center gap-3 p-3">
                  <Avatar name={session.profile.agentName} src={session.profile.avatarUrl} size={36} />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{session.profile.displayName}</div>
                    <div className="truncate text-xs text-ink-dim">{session.profile.agentName}</div>
                  </div>
                  <Badge tone={session.level === "fresh-wallet" ? "signal" : "neutral"} className="ml-auto">{session.level === "fresh-wallet" ? "wallet" : session.method}</Badge>
                </Link>
              ) : (
                <Link href="/welcome"><Button variant="outline" className="w-full"><LogIn className="h-4 w-4" />Sign in with Agent ID</Button></Link>
              )}
            </div>
          </aside>

          <main className="min-w-0 flex-1 pb-24 pt-4 lg:pb-10 lg:pt-6">
            <div className="mb-4 flex items-center justify-between lg:hidden">
              <Link href="/home"><Logo /></Link>
              {authed ? <Link href={`/u/${session.profile?.agentName}`}><Avatar name={session.profile?.agentName ?? "me"} size={32} /></Link> : <Link href="/welcome"><Button size="sm">Sign in</Button></Link>}
            </div>
            {children}
          </main>

          <aside className="sticky top-0 hidden h-dvh w-80 shrink-0 overflow-y-auto py-6 xl:block"><RightPanel /></aside>
        </div>
      )}
      {!bare && (
        <nav aria-label="Mobile" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-obsidian/85 px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">
          <div className="mx-auto flex max-w-md justify-between">
            {MOBILE.map((n) => {
              const active = path.startsWith(n.href);
              return (
                <Link key={n.href} href={n.href} className="relative flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10px]">
                  {active && <motion.span layoutId="mnav" transition={spring} className="absolute top-0 h-0.5 w-8 rounded-full bg-signal" />}
                  <n.icon className={cx("h-5 w-5", active ? "text-signal" : "text-ink-dim")} />
                  <span className={active ? "text-ink" : "text-ink-dim"}>{n.label}</span>
                </Link>
              );
            })}
          </div>
        </nav>
      )}
      <span className="hidden"><User /></span>
    </div>
  );
}
