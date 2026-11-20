import { encodeFunctionData, parseUnits, formatUnits, maxUint256, type Address, type Hex } from "viem";
import { PANCAKE_V2_ROUTER, WBNB, tokenBySymbol, type TokenInfo } from "@atlas/shared-types";

export const PANCAKE_V2_ROUTER_ABI = [
  { type: "function", name: "getAmountsOut", stateMutability: "view", inputs: [{ name: "amountIn", type: "uint256" }, { name: "path", type: "address[]" }], outputs: [{ type: "uint256[]" }] },
  { type: "function", name: "swapExactETHForTokens", stateMutability: "payable", inputs: [{ name: "amountOutMin", type: "uint256" }, { name: "path", type: "address[]" }, { name: "to", type: "address" }, { name: "deadline", type: "uint256" }], outputs: [{ type: "uint256[]" }] },
  { type: "function", name: "swapExactTokensForETH", stateMutability: "nonpayable", inputs: [{ name: "amountIn", type: "uint256" }, { name: "amountOutMin", type: "uint256" }, { name: "path", type: "address[]" }, { name: "to", type: "address" }, { name: "deadline", type: "uint256" }], outputs: [{ type: "uint256[]" }] },
  { type: "function", name: "swapExactTokensForTokens", stateMutability: "nonpayable", inputs: [{ name: "amountIn", type: "uint256" }, { name: "amountOutMin", type: "uint256" }, { name: "path", type: "address[]" }, { name: "to", type: "address" }, { name: "deadline", type: "uint256" }], outputs: [{ type: "uint256[]" }] },
] as const;

export const ERC20_ABI = [
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "event", name: "Transfer", inputs: [{ name: "from", type: "address", indexed: true }, { name: "to", type: "address", indexed: true }, { name: "value", type: "uint256", indexed: false }] },
] as const;

export const DEFAULT_SLIPPAGE_BPS = 50;
export const MAX_SLIPPAGE_BPS = 500;
export const WARN_IMPACT_BPS = 100;
export const BLOCK_IMPACT_BPS = 500;
export const SWAP_CHAIN_ID = 56;

export interface UnsignedTx {
  chainId: number;
  from: Address;
  to: Address;
  data: Hex;
  value: string; // wei, decimal string (JSON-safe)
  description: string;
}

export interface QuoteReader {
  getAmountsOut(amountIn: bigint, path: Address[]): Promise<bigint[]>;
  allowance?(token: Address, owner: Address, spender: Address): Promise<bigint>;
  /**
   * For issuer-restricted tokens: resolves to null when every account may transfer and the token is not paused,
   * otherwise to a human-readable reason. Without this hook, restricted tokens are never prepared.
   */
  transferCheck?(token: Address, accounts: Address[], path: Address[]): Promise<string | null>;
}

export interface SwapPreparation {
  chainId: number;
  router: Address;
  route: string[];
  path: Address[];
  tokenIn: TokenInfo;
  tokenOut: TokenInfo;
  amountIn: string;
  amountInWei: string;
  expectedOut: string;
  minimumOut: string;
  slippageBps: number;
  priceImpactBps: number;
  executionPrice: number;
  deadline: number;
  steps: UnsignedTx[];
  warnings: string[];
  blocked: boolean;
  riskDisclosure: string;
}

export const RISK_DISCLOSURE =
  "Trading digital assets is risky and you can lose money. ATLAS prepares this transaction for your review only: it never holds your keys, never signs for you and never executes without your confirmation in your own wallet. Theses and AI research are not financial advice. Quotes can change before execution; the minimum received protects you from slippage beyond your limit.";

export function buildPath(tokenIn: TokenInfo, tokenOut: TokenInfo): { path: Address[]; route: string[] } {
  const a = tokenIn.native ? WBNB : tokenIn;
  const b = tokenOut.native ? WBNB : tokenOut;
  if (a.address.toLowerCase() === b.address.toLowerCase()) throw new SwapError("tokenIn and tokenOut must differ (use wrap/unwrap)");
  if (a.symbol === "WBNB" || b.symbol === "WBNB") return { path: [a.address, b.address], route: [tokenIn.symbol, tokenOut.symbol] };
  return { path: [a.address, WBNB.address, b.address], route: [tokenIn.symbol, "WBNB", tokenOut.symbol] };
}

export class SwapError extends Error {}

export async function prepareSwap(args: {
  from: Address;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  slippageBps?: number;
  deadlineSeconds?: number;
  reader: QuoteReader;
  now?: number;
  /** Set when unsigned steps will be returned: restricted tokens then require reader.transferCheck to pass. */
  requireTransferCheck?: boolean;
}): Promise<SwapPreparation> {
  const tokenIn = tokenBySymbol(args.tokenIn);
  const tokenOut = tokenBySymbol(args.tokenOut);
  if (!tokenIn || !tokenOut) throw new SwapError("token not on the ATLAS allowlist");
  const slippageBps = args.slippageBps ?? DEFAULT_SLIPPAGE_BPS;
  if (!Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps > MAX_SLIPPAGE_BPS) {
    throw new SwapError(`slippage must be between 1 and ${MAX_SLIPPAGE_BPS} bps`);
  }
  if (!/^\d+(\.\d+)?$/.test(args.amountIn)) throw new SwapError("invalid amount");
  const amountInWei = parseUnits(args.amountIn, tokenIn.decimals);
  if (amountInWei === 0n) throw new SwapError("amount must be > 0");
  const { path, route } = buildPath(tokenIn, tokenOut);

  const amounts = await args.reader.getAmountsOut(amountInWei, path);
  const out = amounts[amounts.length - 1]!;
  if (out === 0n) throw new SwapError("no liquidity for this route");
  const probeIn = amountInWei / 1000n > 0n ? amountInWei / 1000n : 1n;
  const probe = await args.reader.getAmountsOut(probeIn, path);
  const probeOut = probe[probe.length - 1]!;
  // impact = 1 - (out/amountIn) / (probeOut/probeIn)
  const ideal = (probeOut * amountInWei) / probeIn;
  const priceImpactBps = ideal > 0n ? Number(((ideal - out) * 10000n) / ideal) : 0;
  const minOut = (out * BigInt(10000 - slippageBps)) / 10000n;
  const now = args.now ?? Math.floor(Date.now() / 1000);
  const deadline = now + (args.deadlineSeconds ?? 20 * 60);

  const warnings: string[] = [];
  if (priceImpactBps >= WARN_IMPACT_BPS) warnings.push(`High price impact: ${(priceImpactBps / 100).toFixed(2)}%`);
  if (slippageBps > 100) warnings.push(`Slippage tolerance ${slippageBps / 100}% is above 1%`);
  let blocked = priceImpactBps >= BLOCK_IMPACT_BPS;
  if (blocked) warnings.push("Price impact above 5%: ATLAS will not prepare this swap. Reduce the size.");
  for (const t of [tokenIn, tokenOut]) if (t.note) warnings.push(t.note);
  for (const t of [tokenIn, tokenOut].filter((t) => t.restricted)) {
    if (!args.reader.transferCheck) {
      // Quote-only callers (no wallet context) still see the price; preparing requires the on-chain check.
      if (args.requireTransferCheck) { blocked = true; warnings.push(`${t.symbol} transfer controls could not be checked; ATLAS will not prepare this swap.`); }
      continue;
    }
    const reason = await args.reader.transferCheck(t.address, [args.from, PANCAKE_V2_ROUTER], path);
    if (reason) { blocked = true; warnings.push(`${t.symbol} issuer controls would block this swap: ${reason}`); }
  }

  const steps: UnsignedTx[] = [];
  if (!blocked) {
    if (!tokenIn.native) {
      const current = args.reader.allowance ? await args.reader.allowance(tokenIn.address, args.from, PANCAKE_V2_ROUTER) : 0n;
      if (current < amountInWei) {
        steps.push({
          chainId: SWAP_CHAIN_ID,
          from: args.from,
          to: tokenIn.address,
          data: encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [PANCAKE_V2_ROUTER, amountInWei] }),
          value: "0",
          description: `Approve exactly ${args.amountIn} ${tokenIn.symbol} for PancakeSwap V2 Router (no unlimited approval)`,
        });
      }
    }
    let data: Hex;
    let value = 0n;
    if (tokenIn.native) {
      data = encodeFunctionData({ abi: PANCAKE_V2_ROUTER_ABI, functionName: "swapExactETHForTokens", args: [minOut, path, args.from, BigInt(deadline)] });
      value = amountInWei;
    } else if (tokenOut.native) {
      data = encodeFunctionData({ abi: PANCAKE_V2_ROUTER_ABI, functionName: "swapExactTokensForETH", args: [amountInWei, minOut, path, args.from, BigInt(deadline)] });
    } else {
      data = encodeFunctionData({ abi: PANCAKE_V2_ROUTER_ABI, functionName: "swapExactTokensForTokens", args: [amountInWei, minOut, path, args.from, BigInt(deadline)] });
    }
    steps.push({
      chainId: SWAP_CHAIN_ID,
      from: args.from,
      to: PANCAKE_V2_ROUTER,
      data,
      value: value.toString(),
      description: `Swap ${args.amountIn} ${tokenIn.symbol} for at least ${formatUnits(minOut, tokenOut.decimals)} ${tokenOut.symbol}; proceeds go only to your wallet ${args.from}`,
    });
  }

  const outHuman = Number(formatUnits(out, tokenOut.decimals));
  return {
    chainId: SWAP_CHAIN_ID,
    router: PANCAKE_V2_ROUTER,
    route,
    path,
    tokenIn,
    tokenOut,
    amountIn: args.amountIn,
    amountInWei: amountInWei.toString(),
    expectedOut: formatUnits(out, tokenOut.decimals),
    minimumOut: formatUnits(minOut, tokenOut.decimals),
    slippageBps,
    priceImpactBps,
    executionPrice: outHuman / Number(args.amountIn),
    deadline,
    steps,
    warnings,
    blocked,
    riskDisclosure: RISK_DISCLOSURE,
  };
}

/** Guard used by tests and the API: ATLAS never emits unlimited approvals or third-party recipients. */
export function assertSafeSteps(steps: UnsignedTx[], owner: Address) {
  for (const s of steps) {
    if (s.data.startsWith("0x095ea7b3") && s.data.toLowerCase().includes(maxUint256.toString(16))) throw new SwapError("unlimited approval");
    if (s.from.toLowerCase() !== owner.toLowerCase()) throw new SwapError("step from mismatch");
  }
}
