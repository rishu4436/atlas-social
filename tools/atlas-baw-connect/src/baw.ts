/**
 * Runs the official Binance Agentic Wallet CLI with a FIXED argument vector (execFile, no shell).
 * Nothing received from ATLAS is ever executed as a command: callers pass validated values only.
 */
import { execFile } from "node:child_process";

export type BawResult = { ok: true; data: any } | { ok: false; code: string | null; message: string };

export const SAFE_ID = /^[A-Za-z0-9._:-]{1,128}$/;
export const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
export const HEX = /^0x[0-9a-fA-F]*$/;
export const CHAIN = /^(\d{1,7}|CT_\d{1,5})$/;
export const DECIMAL = /^\d{1,30}(\.\d{1,18})?$/;
export const WEI = /^\d{1,78}$/;

/** Official npm package that provides the `baw` CLI. */
export const BAW_PACKAGE = "@binance/agentic-wallet";

/** The only baw subcommands this companion may run. */
const ALLOWED = new Set([
  "wallet status", "wallet address", "wallet agent-id", "wallet settings", "wallet resolve-domain", "wallet send",
  "sign-message preview", "sign-message execute", "sign-message result", "contract-call preview", "contract-call execute",
  "auth signin", "auth verify",
]);

export interface BawRunner { (args: string[], opts?: { timeoutMs?: number }): Promise<BawResult> }

export function bawBinary(env = process.env) { return env.BAW_BIN || "baw"; }

export function parseBawJson(stdout: string, stderr: string): BawResult {
  const text = (stdout || "").trim() || (stderr || "").trim();
  let j: any;
  try { j = JSON.parse(text.slice(text.indexOf("{"))); } catch { return { ok: false, code: text.match(/\b(\d{6,9})\b/)?.[1] ?? null, message: text.slice(0, 400) || "baw returned no JSON" }; }
  if (j && j.success === true) return { ok: true, data: j.data ?? {} };
  // official `baw auth signin --json` is wrapped as { success, data }, but accept a flat payload too
  if (j && j.qrCodeId && j.success !== false) return { ok: true, data: j };
  const code = j?.code ?? j?.errorCode ?? j?.data?.code ?? String(j?.message ?? "").match(/\b(\d{6,9})\b/)?.[1] ?? null;
  return { ok: false, code: code === null ? null : String(code), message: String(j?.message ?? j?.msg ?? "baw error").slice(0, 400) };
}

const AUTH_TIMEOUT_MS = 10 * 60_000;

export function makeRunner(bin = bawBinary(), timeoutMs = 120_000): BawRunner {
  return (args, opts) => new Promise((resolve) => {
    const sub = `${args[0]} ${args[1]}`;
    if (!ALLOWED.has(sub)) { resolve({ ok: false, code: null, message: `refusing to run baw ${sub}` }); return; }
    if (!args.includes("--json")) args = [...args, "--json"];
    const ms = opts?.timeoutMs ?? (sub.startsWith("auth ") ? AUTH_TIMEOUT_MS : timeoutMs);
    execFile(bin, args, { shell: false, timeout: ms, maxBuffer: 4 * 1024 * 1024, env: process.env }, (err, stdout, stderr) => {
      if (err && (err as any).code === "ENOENT") { resolve({ ok: false, code: "BAW_NOT_INSTALLED", message: `baw not found (${bin}). Install: npm i -g ${BAW_PACKAGE}` }); return; }
      resolve(parseBawJson(String(stdout), String(stderr)));
    });
  });
}
