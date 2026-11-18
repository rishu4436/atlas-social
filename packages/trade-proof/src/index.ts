import { decodeFunctionData, decodeEventLog, isAddressEqual, formatUnits, type Address, type Hex, type PublicClient } from "viem";
import { PANCAKE_V2_ROUTER, WBNB, tokenByAddress, hashCanonical } from "@atlas/shared-types";
import { PANCAKE_V2_ROUTER_ABI, ERC20_ABI } from "@atlas/wallet-integration";

export const MIN_CONFIRMATIONS = 15;
export const ROUTER_ALLOWLIST: Address[] = [PANCAKE_V2_ROUTER];

export type ProofStatus = "VERIFIED" | "PENDING" | "REJECTED";

export type RejectReason =
  | "TX_NOT_FOUND"
  | "TX_FAILED"
  | "WRONG_CHAIN"
  | "NOT_CLAIMANT_TX" // tx.from is not the claimant's verified Agent ID wallet
  | "ROUTER_NOT_ALLOWED"
  | "NOT_A_SWAP"
  | "RECIPIENT_NOT_CLAIMANT"
  | "TOKEN_NOT_ALLOWED"
  | "NO_OUTPUT_OBSERVED";

export interface TxLike {
  hash: Hex;
  from: Address;
  to: Address | null;
  input: Hex;
  value: bigint;
  chainId?: number;
  blockNumber: bigint | null;
}
export interface ReceiptLike {
  status: "success" | "reverted";
  blockNumber: bigint;
  logs: { address: Address; topics: Hex[]; data: Hex }[];
}

export interface TradeEvidence {
  txHash: Hex;
  chainId: number;
  wallet: Address;
  router: Address;
  method: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  executionPrice: number;
  blockNumber: string;
  blockTimestamp: number | null;
}

export interface ProofResult {
  status: ProofStatus;
  reasons: RejectReason[];
  confirmations: number;
  evidence: TradeEvidence | null;
  evidenceHash: Hex | null;
}

const reject = (reasons: RejectReason[], confirmations = 0): ProofResult => ({ status: "REJECTED", reasons, confirmations, evidence: null, evidenceHash: null });

/**
 * Pure verification of an execution claim. A tx hash alone is not proof: the transaction must be sent
 * BY the claimant's verified wallet, to an allowlisted router, be a successful swap paying the claimant,
 * and have enough confirmations.
 */
export function verifyTradeEvidence(args: {
  tx: TxLike | null;
  receipt: ReceiptLike | null;
  claimant: Address;
  chainId: number;
  headBlock: bigint;
  blockTimestamp?: number | null;
  minConfirmations?: number;
}): ProofResult {
  const { tx, receipt, claimant } = args;
  if (!tx || !receipt) return reject(["TX_NOT_FOUND"]);
  if (tx.chainId !== undefined && tx.chainId !== args.chainId) return reject(["WRONG_CHAIN"]);
  const reasons: RejectReason[] = [];
  if (!isAddressEqual(tx.from, claimant)) reasons.push("NOT_CLAIMANT_TX");
  if (receipt.status !== "success") reasons.push("TX_FAILED");
  if (!tx.to || !ROUTER_ALLOWLIST.some((r) => isAddressEqual(r, tx.to!))) reasons.push("ROUTER_NOT_ALLOWED");
  if (reasons.length) return reject(reasons);

  let decoded;
  try {
    decoded = decodeFunctionData({ abi: PANCAKE_V2_ROUTER_ABI, data: tx.input });
  } catch {
    return reject(["NOT_A_SWAP"]);
  }
  if (!decoded.functionName.startsWith("swap")) return reject(["NOT_A_SWAP"]);
  const a = decoded.args as readonly unknown[];
  let amountIn: bigint, path: Address[], to: Address;
  if (decoded.functionName === "swapExactETHForTokens") {
    amountIn = tx.value;
    path = a[1] as Address[];
    to = a[2] as Address;
  } else {
    amountIn = a[0] as bigint;
    path = a[2] as Address[];
    to = a[3] as Address;
  }
  if (!isAddressEqual(to, claimant)) return reject(["RECIPIENT_NOT_CLAIMANT"]);
  const tIn = tokenByAddress(path[0]!);
  const tOut = tokenByAddress(path[path.length - 1]!);
  if (!tIn || !tOut) return reject(["TOKEN_NOT_ALLOWED"]);
  const ethIn = decoded.functionName === "swapExactETHForTokens";
  const ethOut = decoded.functionName === "swapExactTokensForETH";

  // Observe actual output from receipt logs.
  let amountOut = 0n;
  for (const log of receipt.logs) {
    let ev;
    try {
      ev = decodeEventLog({ abi: ERC20_ABI, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
    } catch {
      continue;
    }
    if (ev.eventName !== "Transfer") continue;
    const { to: dst, value } = ev.args as { from: Address; to: Address; value: bigint };
    if (ethOut) {
      if (isAddressEqual(log.address, WBNB.address) && isAddressEqual(dst, PANCAKE_V2_ROUTER)) amountOut += value;
    } else if (isAddressEqual(log.address, tOut.address) && isAddressEqual(dst, claimant)) {
      amountOut += value;
    }
  }
  if (amountOut === 0n) return reject(["NO_OUTPUT_OBSERVED"]);

  const confirmations = Number(args.headBlock - receipt.blockNumber + 1n);
  const evidence: TradeEvidence = {
    txHash: tx.hash,
    chainId: args.chainId,
    wallet: claimant,
    router: tx.to!,
    method: decoded.functionName,
    tokenIn: ethIn ? "BNB" : tIn.symbol,
    tokenOut: ethOut ? "BNB" : tOut.symbol,
    amountIn: formatUnits(amountIn, tIn.decimals),
    amountOut: formatUnits(amountOut, tOut.decimals),
    executionPrice: Number(formatUnits(amountOut, tOut.decimals)) / Number(formatUnits(amountIn, tIn.decimals)),
    blockNumber: receipt.blockNumber.toString(),
    blockTimestamp: args.blockTimestamp ?? null,
  };
  const status: ProofStatus = confirmations >= (args.minConfirmations ?? MIN_CONFIRMATIONS) ? "VERIFIED" : "PENDING";
  return { status, reasons: [], confirmations, evidence, evidenceHash: hashCanonical(evidence) };
}

/** Fetches tx + receipt from BSC and runs verifyTradeEvidence. */
export async function verifyTradeProof(client: PublicClient, txHash: Hex, claimant: Address, chainId = 56): Promise<ProofResult> {
  const [tx, receipt, head] = await Promise.all([
    client.getTransaction({ hash: txHash }).catch(() => null),
    client.getTransactionReceipt({ hash: txHash }).catch(() => null),
    client.getBlockNumber(),
  ]);
  let ts: number | null = null;
  if (receipt) ts = Number((await client.getBlock({ blockNumber: receipt.blockNumber })).timestamp);
  return verifyTradeEvidence({
    tx: tx ? { hash: tx.hash, from: tx.from, to: tx.to, input: tx.input, value: tx.value, chainId: tx.chainId, blockNumber: tx.blockNumber } : null,
    receipt: receipt ? { status: receipt.status, blockNumber: receipt.blockNumber, logs: receipt.logs } : null,
    claimant,
    chainId,
    headBlock: head,
    blockTimestamp: ts,
  });
}
