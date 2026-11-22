#!/usr/bin/env node
/**
 * atlas-social-connect — one command to install anything missing and log in to ATLAS Social.
 *
 *   atlas-social-connect login <ATC-code> [--api https://…]
 *   atlas-social-connect pay   <ATC-code> [--api https://…]
 *
 * Installs the official Binance Agentic Wallet CLI (`baw`, package @binance/agentic-wallet) if needed,
 * runs official `baw auth signin` / `baw auth verify` if you are not signed in (Binance's own QR/pairing),
 * then fetches the ATLAS challenge, runs `baw sign-message preview`, and only signs after you type y.
 *
 * Guarantees: no listening server, no shell, only an allowlist of documented baw subcommands with
 * validated arguments, never reads or asks for Binance credentials, never prints secrets.
 * Signing in to the website still happens in the browser that showed the code.
 */
import { createInterface } from "node:readline";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { makeRunner, bawBinary } from "./baw.js";
import { makeApi, checkApiUrl, DEFAULT_API, AtlasApiError } from "./api.js";
import { runLogin, runPay, StopError, type Io } from "./flow.js";

const CODE = /^ATC-[0-9A-HJKMNP-TV-Z]{26}$/;

export async function main(argv: string[], io?: Io) {
  const [cmd, rawCode, ...rest] = argv;
  if (!cmd || cmd === "--help" || cmd === "-h" || !["login", "pay"].includes(cmd)) {
    console.log(`usage: atlas-social-connect login|pay <ATC-code> [--api https://atlas-social-api.onrender.com]

One command: installs the official Binance Agentic Wallet CLI (baw) if needed,
signs you in with Binance's official QR if needed, previews the ATLAS message,
and only signs after you type y.

  npx --yes atlas-social-connect@latest login ATC-…`);
    return !cmd || cmd === "--help" || cmd === "-h" ? 0 : 64;
  }
  const code = String(rawCode ?? "").trim().toUpperCase();
  if (!CODE.test(code)) { console.error("That is not an ATLAS connection code (ATC-…). Copy it from the ATLAS website."); return 64; }
  let api = DEFAULT_API;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--api" && rest[i + 1]) api = rest[++i]!;
    else { console.error(`unknown option ${rest[i]}`); return 64; }
  }
  try { api = checkApiUrl(api); } catch (e) { console.error((e as Error).message); return 64; }
  const rl = io ? null : createInterface({ input: process.stdin, terminal: false });
  // buffered lines so piped input ("n\n" or "yes\n") works as well as a TTY; EOF answers "" (= cancel)
  const lines: string[] = []; const waiters: ((s: string) => void)[] = []; let closed = false;
  rl?.on("line", (l) => { const w = waiters.shift(); if (w) w(l); else lines.push(l); });
  rl?.on("close", () => { closed = true; for (const w of waiters.splice(0)) w(""); });
  const theIo: Io = io ?? {
    log: (s) => console.log(s),
    ask: (q) => { process.stdout.write(q); return lines.length ? Promise.resolve(lines.shift()!) : closed ? Promise.resolve("") : new Promise((r) => waiters.push(r)); },
  };
  theIo.log("atlas-social-connect");
  if (api !== DEFAULT_API) theIo.log(`  Using ATLAS API ${api} (not the default).`);
  if (bawBinary() !== "baw") theIo.log(`  Using BAW_BIN=${bawBinary()} instead of the official baw CLI.`);
  try {
    const ctx = { api: makeApi(api), baw: makeRunner(), io: theIo };
    if (cmd === "login") await runLogin(ctx, code); else await runPay(ctx, code);
    return 0;
  } catch (e) {
    if (e instanceof StopError) { theIo.log(`\n✖ ${e.message}`); return e.exitCode; }
    if (e instanceof AtlasApiError) { theIo.log(`\n✖ ATLAS: ${e.code} — ${e.message}`); return 1; }
    theIo.log(`\n✖ ${(e as Error).message}`);
    return 1;
  } finally { rl?.close(); }
}

function isMainModule() {
  const arg = process.argv[1];
  if (!arg) return false;
  try { return import.meta.url === pathToFileURL(realpathSync(arg)).href; } catch { return /atlas-social-connect|atlas-baw-connect|atlas-connect/.test(arg); }
}
if (isMainModule()) main(process.argv.slice(2)).then((c) => process.exit(c));
