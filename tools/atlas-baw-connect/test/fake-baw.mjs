#!/usr/bin/env node
/**
 * TEST DOUBLE of the Binance Agentic Wallet CLI — NOT baw, NOT affiliated with Binance.
 * Used only by automated tests and the local e2e suite to exercise the ATLAS Connect handoff end to end.
 * It signs with a throwaway test key (FAKE_BAW_KEY) and talks only to a LOCAL dev chain; it refuses chain 56.
 * Output shapes follow binance-skills-hub references (wallet-view.md, external-sign.md, send.md, domain-resolve.md).
 *
 * env: FAKE_BAW_KEY (0x… test key), FAKE_BAW_STATE (json file), FAKE_BAW_RPC (default http://127.0.0.1:8545),
 *      FAKE_BAW_HANDLE, FAKE_BAW_CONFIRM=1 (app confirmation), FAKE_BAW_FAIL=<cmd>:<code>, FAKE_BAW_RESOLVE (json name→address),
 *      FAKE_BAW_UNCONNECTED=1, FAKE_BAW_DEVMODE_OFF=1
 */
import fs from "node:fs";
import { createWalletClient, createPublicClient, http, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const out = (o, code = 0) => { process.stdout.write(JSON.stringify(o) + "\n"); process.exit(code); };
const ok = (data) => out({ success: true, data });
const fail = (code, message) => out({ success: false, code, message }, 1);
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const sub = `${args[0]} ${args[1]}`;
const env = process.env;
if (!env.FAKE_BAW_KEY) fail("FAKE", "FAKE_BAW_KEY not set");
const account = privateKeyToAccount(env.FAKE_BAW_KEY);
const statePath = env.FAKE_BAW_STATE ?? "/tmp/fake-baw-state.json";
const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, "utf8")) : {};
const save = () => fs.writeFileSync(statePath, JSON.stringify(state));
const failSpec = (env.FAKE_BAW_FAIL ?? "").split(":");
if (failSpec[0] && sub === failSpec[0].replace("_", " ")) fail(failSpec[1], `simulated baw failure ${failSpec[1]}`);
const rid = () => Math.random().toString(16).slice(2, 18);
const rpc = env.FAKE_BAW_RPC ?? "http://127.0.0.1:8545";

async function chain() {
  const pub = createPublicClient({ transport: http(rpc) });
  const id = await pub.getChainId();
  if (id === 56 || id === 1) fail("FAKE", "test double refuses mainnet chains");
  const c = defineChain({ id, name: "local", nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
  return { pub, wallet: createWalletClient({ account, chain: c, transport: http(rpc) }) };
}

switch (sub) {
  case "wallet status": ok({ status: env.FAKE_BAW_UNCONNECTED ? "UNCONNECTED" : "CONNECTED" }); break;
  case "wallet address": ok({ addresses: [{ binanceChainId: "CT_501", chainName: "Solana", address: "E1111111111111111111111111111111111111111S" }, { binanceChainId: "56", chainName: "BSC", address: account.address }] }); break;
  case "wallet agent-id": ok(env.FAKE_BAW_HANDLE ? { claimed: true, handle: env.FAKE_BAW_HANDLE, agentId: `${env.FAKE_BAW_HANDLE}.ai` } : { claimed: false }); break;
  case "wallet settings": ok({ devMode: { enabled: !env.FAKE_BAW_DEVMODE_OFF, expiresAt: Date.now() + 7 * 86400_000 } }); break;
  case "sign-message preview": {
    const m = JSON.parse(opt("--message"));
    if (m.method !== "eth_signTypedData_v4" || m.params[0].toLowerCase() !== account.address.toLowerCase()) fail("351801", "not your wallet");
    const td = JSON.parse(m.params[1]);
    const requestId = rid();
    state[requestId] = { kind: "sign", td };
    save();
    ok({ requestId, parsedMessage: { messageType: "SignTypedData", preCheckCode: "", version: "V4", message: m.params[1] }, risks: { riskDetails: [], addresses: {}, riskBehaviors: [] }, requireConfirmation: !!env.FAKE_BAW_CONFIRM, expiresAt: Date.now() + 300_000 });
    break;
  }
  case "sign-message execute": {
    const r = state[opt("--requestId")];
    if (!r || r.kind !== "sign") fail("351806", "preview expired");
    const { EIP712Domain, ...types } = r.td.types;
    const sig = await account.signTypedData({ domain: r.td.domain, types, primaryType: r.td.primaryType, message: r.td.message });
    const body = sig.slice(2, 130), v = parseInt(sig.slice(130), 16);
    const orderId = `msg-order-${rid()}`;
    state[orderId] = { signature: body, signatureRecovery: v === 28 ? "01" : "00" };
    delete state[opt("--requestId")];
    save();
    if (env.FAKE_BAW_CONFIRM) ok({ orderId, status: "PENDING_CONFIRMATION", signature: null, signatureRecovery: null, message: "Please confirm in the Binance App" });
    ok({ orderId, status: "COMPLETED", ...state[orderId], message: null });
    break;
  }
  case "sign-message result": {
    const o = state[opt("--order-id")];
    if (!o) fail("351807", "unknown order");
    ok({ orderId: opt("--order-id"), status: "COMPLETED", ...o, message: null });
    break;
  }
  case "contract-call preview": {
    if (opt("--from").toLowerCase() !== account.address.toLowerCase()) fail("351801", "not your wallet");
    const requestId = rid();
    state[requestId] = { kind: "call", to: opt("--to"), value: opt("--value") ?? "0", data: opt("--inputData") ?? "0x" };
    save();
    ok({ requestId, parsedTx: { to: opt("--to"), amount: opt("--value") ?? "0" }, simulationResult: { success: true }, risks: { riskDetails: [], addresses: {} }, authorityChanges: [], requireConfirmation: false });
    break;
  }
  case "contract-call execute": {
    const r = state[opt("--requestId")];
    if (!r || r.kind !== "call") fail("351806", "preview expired");
    const { wallet } = await chain();
    const txHash = await wallet.sendTransaction({ to: r.to, data: r.data, value: BigInt(r.value), gas: 500_000n });
    delete state[opt("--requestId")]; save();
    ok({ orderId: `order-${rid()}`, status: "BROADCASTED", txHash, message: null });
    break;
  }
  case "wallet resolve-domain": {
    const map = JSON.parse(env.FAKE_BAW_RESOLVE ?? "{}");
    const a = map[opt("--name")];
    if (!a) fail("20003009", "domain not found");
    ok({ name: opt("--name"), binanceChainId: "56", address: a, isFallback: false, addressType: "EOA" });
    break;
  }
  case "wallet send": {
    const { wallet } = await chain();
    const token = opt("--tokenAddress");
    if (token.toLowerCase() !== "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee") fail("FAKE", "test double sends native only");
    const [w, f = ""] = opt("--amount").split(".");
    const wei = BigInt(w) * 10n ** 18n + BigInt((f + "0".repeat(18)).slice(0, 18));
    ok({ txHash: await wallet.sendTransaction({ to: opt("--recipient"), value: wei }) });
    break;
  }
  default: fail("FAKE", `test double does not implement ${sub}`);
}
