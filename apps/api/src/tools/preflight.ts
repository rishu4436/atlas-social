/**
 * READ-ONLY go-live preflight. Sends no transactions and needs no keys.
 *   npx tsx src/tools/preflight.ts [--wallet 0xAgentIdHolder] [--deployment ../../packages/contracts/deployments/56.json] [--api https://api.example]
 * Checks: official Agent ID registry is live on BSC and answers the ABI ATLAS uses; optional holder lookup;
 * optional deployment file sanity (chain 56, official registry, bytecode present); optional running API /config.
 */
import { createPublicClient, http, getAddress, type Address } from "viem";
import { bsc } from "viem/chains";
import { readFileSync, existsSync } from "node:fs";
import { AGENT_ID_READ_ABI, OnchainAgentIdResolver } from "@atlas/agent-id";

const OFFICIAL = getAddress("0x60b9262456de011f7d15a54cdd8c48baaa8b022f");
const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
const rpc = process.env.BSC_RPC_URL ?? "https://bsc-rpc.publicnode.com";
const client = createPublicClient({ chain: bsc, transport: http(rpc) });
let failures = 0;
const ok = (c: boolean, msg: string) => { console.log(`${c ? "PASS" : "FAIL"}  ${msg}`); if (!c) failures++; };

const ERC721_META = [
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
] as const;

ok((await client.getChainId()) === 56, `RPC ${rpc} is BSC mainnet`);
const code = await client.getCode({ address: OFFICIAL });
ok(!!code && code !== "0x", `official Agent ID registry ${OFFICIAL} has bytecode`);
try {
  const [name, symbol] = await Promise.all([client.readContract({ address: OFFICIAL, abi: ERC721_META, functionName: "name" }), client.readContract({ address: OFFICIAL, abi: ERC721_META, functionName: "symbol" })]);
  console.log(`      name="${name}" symbol="${symbol}"`);
} catch (e) { console.log(`      (name/symbol not readable: ${(e as Error).message.slice(0, 80)})`); }
const zero = (await client.readContract({ address: OFFICIAL, abi: AGENT_ID_READ_ABI, functionName: "balanceOf", args: ["0x000000000000000000000000000000000000dEaD"] })) as bigint;
ok(zero === 0n, "balanceOf(dead) answers (0) with the ABI ATLAS uses");

const w = arg("wallet");
if (w) {
  const id = await new OnchainAgentIdResolver(client as any, OFFICIAL).resolve(getAddress(w) as Address);
  ok(id.eligible, `wallet ${w} holds an Agent ID${id.agentName ? ` (${id.agentName})` : ""}`);
}

const dep = arg("deployment");
if (dep) {
  if (!existsSync(dep)) ok(false, `deployment file ${dep} exists`);
  else {
    const d = JSON.parse(readFileSync(dep, "utf8"));
    ok(d.chainId === 56, "deployment chainId = 56");
    ok(getAddress(d.agentId) === OFFICIAL && d.agentIdIsMock === false, "deployment uses the official Agent ID registry (not a mock)");
    for (const k of ["AtlasIdentityRegistry", "AtlasThesisRegistry", "AtlasReviewRegistry", "AtlasOutcomeRegistry"]) {
      const c = await client.getCode({ address: d[k] });
      ok(!!c && c !== "0x", `${k} ${d[k]} deployed`);
    }
  }
}

const api = arg("api");
if (api) {
  const c = await (await fetch(`${api.replace(/\/$/, "")}/config`)).json();
  ok(c.chainId === 56, "API /config chainId = 56");
  ok(c.agentIdIsMock === false && getAddress(c.contracts.agentId) === OFFICIAL, "API uses the official Agent ID registry");
  ok(c.marketData?.simulated === false, "API market data is live (not simulated)");
}
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
