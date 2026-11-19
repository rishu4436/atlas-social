import type { Page } from "@playwright/test";
import { spawn } from "node:child_process";
import { createTestClient, createWalletClient, createPublicClient, http, parseEther, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";

const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const API = process.env.API_URL ?? "http://127.0.0.1:4000";
const REGISTER_ABI = [{ type: "function", name: "register", stateMutability: "nonpayable", inputs: [{ name: "handle", type: "string" }], outputs: [{ type: "uint256" }] }] as const;

/** Creates a fresh Agent ID holder on the LOCAL anvil MockAgentID (dev only; refuses any other chain). */
export async function newHolder(handlePrefix = "e2e") {
  const cfg = await (await fetch(`${API}/config`)).json();
  if (cfg.chainId !== 31337) throw new Error("e2e holder creation only runs against local anvil");
  const key = generatePrivateKey(); // throwaway LOCAL anvil test key, never a real wallet
  const account = privateKeyToAccount(key);
  await createTestClient({ chain: foundry, mode: "anvil", transport: http(RPC) }).setBalance({ address: account.address, value: parseEther("1") });
  const w = createWalletClient({ account, chain: foundry, transport: http(RPC) });
  const handle = `${handlePrefix}${Math.random().toString(36).slice(2, 7)}`;
  const hash = await w.writeContract({ address: cfg.contracts.agentId, abi: REGISTER_ABI, functionName: "register", args: [handle] });
  await createPublicClient({ chain: foundry, transport: http(RPC) }).waitForTransactionReceipt({ hash });
  return { account, key, handle, agentName: `${handle}.ai` };
}

/** Drives the real /welcome Advanced (manual) path: wallet -> challenge -> paste signature. Signing happens locally, like a user's wallet. */
export async function loginViaUi(page: Page, holder: Awaited<ReturnType<typeof newHolder>>) {
  await page.goto("/welcome");
  await page.getByText("Advanced options").click();
  await page.getByLabel("Agent ID wallet").fill(holder.account.address);
  const [resp] = await Promise.all([page.waitForResponse((r) => r.url().endsWith("/api/auth/challenge")), page.getByRole("button", { name: "Continue", exact: true }).click()]);
  const ch = await resp.json();
  const { EIP712Domain: _d, ...types } = ch.typedData.types;
  const sig = await holder.account.signTypedData({ domain: ch.typedData.domain, types, primaryType: "AtlasLogin", message: { ...ch.typedData.message, issuedAt: BigInt(ch.typedData.message.issuedAt), expiresAt: BigInt(ch.typedData.message.expiresAt) } });
  await page.locator("#sig").fill(sig as Hex);
  await page.getByRole("button", { name: /verify signature/i }).click();
  await finishSignIn(page);
}

/** After any sign-in: accounts that never saved their profile land on /welcome/profile; "Skip for now" completes setup. */
export async function finishSignIn(page: Page) {
  await page.waitForURL(/\/(home|welcome\/profile)$/, { timeout: 20_000 });
  if (page.url().endsWith("/welcome/profile")) {
    await page.getByRole("button", { name: /skip for now/i }).click();
    await page.waitForURL("**/home", { timeout: 20_000 });
  }
}

/**
 * Runs the atlas-baw-connect companion against the local API with the labelled baw TEST DOUBLE
 * (tools/atlas-baw-connect/test/fake-baw.mjs: signs with the throwaway holder key, local chain only).
 * `answer` is what the user types at the approval prompt.
 */
export function runCompanion(cmd: "login" | "pay", code: string, holder: Awaited<ReturnType<typeof newHolder>>, opts: { answer?: string; env?: Record<string, string> } = {}) {
  const root = new URL("../../", import.meta.url).pathname;
  return new Promise<{ code: number; out: string }>((resolve) => {
    const child = spawn("npx", ["tsx", `${root}tools/atlas-baw-connect/src/cli.ts`, cmd, code, "--api", API], {
      cwd: root, env: { ...process.env, BAW_BIN: `${root}tools/atlas-baw-connect/test/fake-baw.mjs`, FAKE_BAW_KEY: holder.key, FAKE_BAW_HANDLE: holder.handle, FAKE_BAW_STATE: `/tmp/fake-baw-${holder.handle}.json`, FAKE_BAW_RPC: RPC, ...opts.env },
    });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { out += d; });
    child.stdin.end(`${opts.answer ?? "yes"}\n`);
    child.on("close", (c) => resolve({ code: c ?? 1, out }));
  });
}
