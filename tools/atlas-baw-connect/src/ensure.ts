/**
 * Make sure the official `baw` CLI is installed and signed in, in the same step as ATLAS login.
 * Installs only @binance/agentic-wallet (Binance's official package). Sign-in is official
 * `baw auth signin` / `baw auth verify` — the QR/pairing come from Binance, never from ATLAS.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { BAW_PACKAGE, SAFE_ID, type BawRunner, type BawResult } from "./baw.js";
import { StopError } from "./errors.js";
import type { Ctx } from "./flow.js";

export function npmGlobalBin(env = process.env): string | null {
  const prefix = env.npm_config_prefix?.trim();
  if (prefix) return process.platform === "win32" ? prefix : join(prefix, "bin");
  return null;
}

function candidates(name: string, env = process.env): string[] {
  const exts = process.platform === "win32"
    ? (env.PATHEXT || ".EXE;.CMD;.BAT;.COM").split(";").flatMap((e) => [e, e.toLowerCase()])
    : [""];
  const dirs = [
    ...(env.PATH || "").split(delimiter),
    npmGlobalBin(env) ?? "",
    dirname(process.execPath),
  ].filter(Boolean);
  const names = exts.map((e) => `${name}${e}`);
  const out: string[] = [];
  for (const dir of dirs) for (const n of names) out.push(join(dir, n));
  return out;
}

export function whichCmd(name: string, env = process.env): string | null {
  for (const p of candidates(name, env)) {
    if (p && existsSync(p)) return p;
  }
  return null;
}

export function findNpm(env = process.env): string | null {
  return whichCmd("npm", env);
}

export function findBaw(env = process.env): string | null {
  if (env.BAW_BIN) return env.BAW_BIN;
  return whichCmd("baw", env);
}

function runExec(bin: string, args: string[], timeoutMs = 180_000): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { shell: false, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, env: process.env }, (err, stdout, stderr) => {
      if (err && (err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new Error(`command not found: ${bin}`));
        return;
      }
      resolve({ code: err ? (err as NodeJS.ErrnoException).code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" ? 1 : (err as any).status ?? (err as any).code ?? 1 : 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

function prependPath(dir: string) {
  if (!dir) return;
  const cur = process.env.PATH || "";
  if (!cur.split(delimiter).includes(dir)) process.env.PATH = `${dir}${delimiter}${cur}`;
}

/** Install the official Binance package globally and return a path to `baw`. */
export async function installOfficialBaw(log: (s: string) => void, env = process.env): Promise<string> {
  const npm = findNpm(env);
  if (!npm) throw new StopError(`Node.js/npm was found, but the npm program is not on PATH. Install Node.js 18+ from https://nodejs.org then re-run this command. After that, this tool will install ${BAW_PACKAGE} (the official Binance Agentic Wallet CLI) for you.`, 2);
  log(`The official Binance Agentic Wallet CLI (baw) is not installed.`);
  log(`Installing ${BAW_PACKAGE} globally with npm. This is Binance's official package; ATLAS does not replace it.`);
  log(`  ${npm} i -g ${BAW_PACKAGE}`);
  const result = await runExec(npm, ["i", "-g", BAW_PACKAGE], 300_000);
  const out = (result.stdout + "\n" + result.stderr).trim();
  if (out) {
    // show npm's own report so the user can see the package name and version; never includes secrets
    for (const line of out.split(/\r?\n/).slice(-20)) log(`  ${line}`);
  }
  if (result.code && result.code !== 0) {
    throw new StopError(`npm failed to install ${BAW_PACKAGE} (exit ${result.code}). You can try the same command yourself: npm i -g ${BAW_PACKAGE}`, 2);
  }
  // After a global install, the bin may be in npm's prefix, which might not already be on PATH.
  const prefix = await runExec(npm, ["prefix", "-g"], 30_000).catch(() => null);
  const prefixDir = prefix?.stdout?.trim();
  if (prefixDir) prependPath(process.platform === "win32" ? prefixDir : join(prefixDir, "bin"));
  const found = findBaw({ ...process.env, BAW_BIN: undefined });
  if (!found) throw new StopError(`Installed ${BAW_PACKAGE}, but the baw program is not on PATH yet. Close this terminal, open a new one, and re-run this command.`, 2);
  log(`Installed. Using baw at ${found}.`);
  return found;
}

export function signedInFrom(result: BawResult): boolean {
  if (!result.ok) {
    const msg = `${result.code ?? ""} ${result.message}`.toLowerCase();
    if (result.code === "BAW_NOT_INSTALLED") return false;
    if (/\bnot logged in\b|\bunconnected\b|not_logged_in|no session/.test(msg)) return false;
    return false;
  }
  const status = String(result.data?.status ?? result.data?.connectionStatus ?? "").toUpperCase();
  if (status) return status === "CONNECTED";
  const addrs = result.data?.addresses;
  return Array.isArray(addrs) && addrs.length > 0;
}

export async function isSignedIn(baw: BawRunner): Promise<boolean> {
  const st = await baw(["wallet", "status", "--json"]);
  if (st.ok || st.code !== "BAW_NOT_INSTALLED") return signedInFrom(st);
  return false;
}

/**
 * Official Binance sign-in: `baw auth signin --json` then `baw auth verify --qrCodeId …`.
 * Prints Binance's own login URL and pairing code. Does not invent a QR.
 */
export async function officialSignIn(ctx: Ctx): Promise<void> {
  const { io } = ctx;
  io.log("Your Binance Agentic Wallet CLI is not signed in.");
  io.log("Starting official Binance sign-in (`baw auth signin`). Scan or open what Binance shows — this is not an ATLAS QR or pairing code.");
  const started = await ctx.baw(["auth", "signin", "--json"]);
  if (!started.ok) throw new StopError(`baw auth signin failed: ${started.message}. You can run \`baw auth signin\` yourself (that pairing is between you and Binance), then re-run this command.`, 2);
  const data = started.data ?? {};
  const already = String(data.status ?? data.connectionStatus ?? "").toUpperCase();
  if (already === "CONNECTED" || already === "SUCCESS") {
    io.log("  Binance reports the wallet is already signed in.");
    return;
  }
  const qrCodeId = typeof data.qrCodeId === "string" ? data.qrCodeId : "";
  const url = typeof data.urlForWeb === "string" ? data.urlForWeb : "";
  const pairing = typeof data.pairingCode === "string" ? data.pairingCode : "";
  const expireAt = data.expireAt;
  if (url) io.log(`  Official Binance login page: ${url}`);
  if (pairing) io.log(`  Binance pairing code: ${pairing}`);
  if (expireAt) {
    const n = Number(expireAt);
    const d = new Date(n > 1e12 ? n : n * 1000);
    if (!Number.isNaN(d.getTime())) io.log(`  Expires: ${d.toLocaleString()}`);
  }
  if (!qrCodeId || !SAFE_ID.test(qrCodeId)) {
    throw new StopError("baw auth signin did not return a usable official qrCodeId. Run `baw auth signin` yourself, then re-run this command.", 2);
  }
  io.log(`  QR Code ID (from Binance): ${qrCodeId}`);
  io.log("Waiting for you to approve in the Binance App (`baw auth verify`)…");
  const verified = await ctx.baw(["auth", "verify", "--qrCodeId", qrCodeId, "--json"]);
  if (!verified.ok) throw new StopError(`baw auth verify failed: ${verified.message}. If the code expired, re-run this command to start official Binance sign-in again.`, 2);
  io.log("  Signed in to Binance Agentic Wallet.");
}

/** Install baw if needed, then run official Binance sign-in if the CLI is not signed in. Returns the current wallet status. */
export async function ensureWalletReady(ctx: Ctx): Promise<BawResult> {
  if (!process.env.BAW_BIN) {
    const existing = findBaw();
    if (!existing) {
      const installed = await installOfficialBaw((s) => ctx.io.log(s));
      if (installed) prependPath(dirname(installed));
    }
  }
  let st = await ctx.baw(["wallet", "status", "--json"]);
  if (!st.ok && st.code === "BAW_NOT_INSTALLED") throw new StopError(st.message, 2);
  if (signedInFrom(st)) return st;
  if (!st.ok) {
    const ad = await ctx.baw(["wallet", "address", "--json"]);
    if (signedInFrom(ad)) return { ok: true, data: { status: "CONNECTED", addresses: ad.ok ? ad.data?.addresses : [] } };
  }
  await officialSignIn(ctx);
  st = await ctx.baw(["wallet", "status", "--json"]);
  return st;
}

