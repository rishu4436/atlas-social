import type { Page } from "@playwright/test";
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
  const account = privateKeyToAccount(generatePrivateKey());
  await createTestClient({ chain: foundry, mode: "anvil", transport: http(RPC) }).setBalance({ address: account.address, value: parseEther("1") });
  const w = createWalletClient({ account, chain: foundry, transport: http(RPC) });
  const handle = `${handlePrefix}${Math.random().toString(36).slice(2, 7)}`;
  const hash = await w.writeContract({ address: cfg.contracts.agentId, abi: REGISTER_ABI, functionName: "register", args: [handle] });
  await createPublicClient({ chain: foundry, transport: http(RPC) }).waitForTransactionReceipt({ hash });
  return { account, handle, agentName: `${handle}.ai` };
}

/** Drives the real /welcome UI: wallet -> challenge -> paste signature. Signing happens locally, like a user's wallet. */
export async function loginViaUi(page: Page, holder: Awaited<ReturnType<typeof newHolder>>) {
  await page.goto("/welcome");
  await page.getByLabel("Agent ID wallet").fill(holder.account.address);
  const [resp] = await Promise.all([page.waitForResponse((r) => r.url().endsWith("/api/auth/challenge")), page.getByRole("button", { name: /continue/i }).click()]);
  const ch = await resp.json();
  const { EIP712Domain: _d, ...types } = ch.typedData.types;
  const sig = await holder.account.signTypedData({ domain: ch.typedData.domain, types, primaryType: "AtlasLogin", message: { ...ch.typedData.message, issuedAt: BigInt(ch.typedData.message.issuedAt), expiresAt: BigInt(ch.typedData.message.expiresAt) } });
  await page.locator("#sig").fill(sig as Hex);
  await page.getByRole("button", { name: /verify signature/i }).click();
  await page.waitForURL("**/home", { timeout: 20_000 });
}
