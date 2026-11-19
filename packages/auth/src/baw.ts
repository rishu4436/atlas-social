import type { Address, Hex } from "viem";
import { typedDataJson, type LoginChallenge } from "./challenge.js";
import { quoteFor, quotePosix, type ShellKind } from "./onboarding.js";

/**
 * The documented Binance Agentic Wallet external-sign sequence
 * (binance-skills-hub/skills/binance-web3/binance-agentic-wallet/references/external-sign.md).
 * ATLAS never runs these commands and never sees wallet credentials: the user (or their own agent)
 * runs them locally and pastes back the signature.
 */
export function bawSignInCommands(c: LoginChallenge) {
  const message = JSON.stringify({ method: "eth_signTypedData_v4", params: [c.wallet, typedDataJson(c)] });
  const previewFor = (sh: ShellKind) => `baw sign-message preview --binanceChainId ${c.chainId} --signType EIP712 --message ${quoteFor(sh, message)} --json`;
  return {
    install: "npm i -g @binance/agentic-wallet",
    checkStatus: "baw wallet status --json",
    checkAgentId: "baw wallet agent-id --json",
    checkAddress: "baw wallet address --json",
    checkDevMode: "baw wallet settings --json",
    preview: `baw sign-message preview --binanceChainId ${c.chainId} --signType EIP712 --message ${quotePosix(message)} --json`,
    previewByShell: { posix: previewFor("posix"), powershell: previewFor("powershell"), cmd: previewFor("cmd") },
    execute: "baw sign-message execute --requestId <requestId from preview> --json",
    result: "baw sign-message result --order-id <orderId> --json",
    message,
  };
}

/** `baw contract-call preview` for an unsigned call ATLAS prepared (identity proof, thesis, review, swap). */
export function bawContractCallCommand(args: { chainId: number; from: Address; to: Address; data: Hex; value?: bigint }) {
  return {
    checkDevMode: "baw wallet settings --json",
    preview: `baw contract-call preview --binanceChainId ${args.chainId} --from ${args.from} --to ${args.to} --value ${(args.value ?? 0n).toString()} --inputData ${args.data} --json`,
    execute: "baw contract-call execute --requestId <requestId from preview> --json",
    note: "Review parsedTx, simulationResult, risks and authorityChanges from the preview before executing. If the preview is intercepted (e.g. 351803) do not execute; ATLAS offers no bypass.",
  };
}
