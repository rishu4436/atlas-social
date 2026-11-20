import type { Address } from "viem";

export interface TokenInfo {
  symbol: string;
  name: string;
  address: Address;
  decimals: number;
  /** Binance spot symbol used for market data, quoted in USDT. */
  marketSymbol: string | null;
  native?: boolean;
  /** "tokenized-stock" = an issuer-controlled certificate tracking a listed share (not a crypto asset). */
  assetClass?: "crypto" | "stablecoin" | "tokenized-stock";
  /**
   * Issuer transfer controls: the token checks a compliance list on every transfer and the issuer can pause it.
   * Swaps are only prepared after an on-chain pre-check that the wallet and router are allowed and the token is not paused.
   */
  restricted?: boolean;
  /** Plain-language note shown with quotes for non-standard assets. */
  note?: string;
}

/** PancakeSwap V2 on BSC mainnet (router.WETH() == WBNB, verified on-chain 2026-11-18). */
export const PANCAKE_V2_ROUTER: Address = "0x10ED43C718714eb63d5aA57B78B54704E256024E";
export const PANCAKE_V2_FACTORY: Address = "0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73";
export const NATIVE_TOKEN_SENTINEL: Address = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

/** Strict allowlist for the first release (symbols/decimals verified on-chain 2026-11-18). */
export const BSC_TOKENS: TokenInfo[] = [
  { symbol: "BNB", name: "BNB (native)", address: NATIVE_TOKEN_SENTINEL, decimals: 18, marketSymbol: "BNBUSDT", native: true },
  { symbol: "WBNB", name: "Wrapped BNB", address: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", decimals: 18, marketSymbol: "BNBUSDT" },
  { symbol: "USDT", name: "Tether USD (BSC)", address: "0x55d398326f99059fF775485246999027B3197955", decimals: 18, marketSymbol: null },
  { symbol: "USDC", name: "USD Coin (BSC)", address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", decimals: 18, marketSymbol: "USDCUSDT" },
  { symbol: "FDUSD", name: "First Digital USD", address: "0xc5f0f7b66764F6ec8C8Dff7BA683102295E16409", decimals: 18, marketSymbol: "FDUSDUSDT" },
  { symbol: "BTCB", name: "Bitcoin BEP2 (BTCB)", address: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c", decimals: 18, marketSymbol: "BTCUSDT" },
  { symbol: "ETH", name: "Binance-Peg Ethereum", address: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8", decimals: 18, marketSymbol: "ETHUSDT" },
  { symbol: "CAKE", name: "PancakeSwap Token", address: "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82", decimals: 18, marketSymbol: "CAKEUSDT" },
  /**
   * NVIDIA tokenized share certificate (verified on-chain 2026-11-20: name "NVIDIA Corp", 18 decimals, beacon proxy ->
   * SecuritiesToken with compliance + pause manager + ERC-8056 scaled UI multiplier). Liquidity used: PancakeSwap V2
   * NVDAB/WBNB pair 0x217e9ed14C797dF4597512D2245c00cA93e5a567 (the direct NVDAB/USDT V2 pair is dust). No Binance spot
   * market, so it is swappable only and not a thesis market; DEX execution price is the price source.
   */
  {
    symbol: "NVDAB", name: "NVIDIA Corp (tokenized stock)", address: "0x02Fca66C1D1aFB4E2A7884261eB00F63598a7436", decimals: 18, marketSymbol: null,
    assetClass: "tokenized-stock", restricted: true,
    note: "NVDAB is a tokenized NVIDIA share certificate, not NVIDIA stock itself and not a crypto asset. Its issuer can pause transfers or block addresses. Amounts are raw on-chain units (balanceOf); some wallets show a slightly larger figure scaled by the issuer's UI multiplier. Price comes from PancakeSwap liquidity only and can differ from the Nasdaq price, especially when US markets are closed.",
  },
];

export const WBNB = BSC_TOKENS[1]!;
export const USDT = BSC_TOKENS[2]!;

export function tokenBySymbol(symbol: string): TokenInfo | undefined {
  return BSC_TOKENS.find((t) => t.symbol.toLowerCase() === symbol.toLowerCase());
}

export function tokenByAddress(address: string): TokenInfo | undefined {
  return BSC_TOKENS.find((t) => t.address.toLowerCase() === address.toLowerCase());
}

/** Markets shown in the app: asset slug -> base token + Binance spot symbol. */
export const MARKETS = [
  { asset: "BNB", base: "WBNB", quote: "USDT", symbol: "BNBUSDT" },
  { asset: "BTC", base: "BTCB", quote: "USDT", symbol: "BTCUSDT" },
  { asset: "ETH", base: "ETH", quote: "USDT", symbol: "ETHUSDT" },
  { asset: "CAKE", base: "CAKE", quote: "USDT", symbol: "CAKEUSDT" },
  { asset: "USDC", base: "USDC", quote: "USDT", symbol: "USDCUSDT" },
] as const;
export type MarketAsset = (typeof MARKETS)[number]["asset"];

export function marketByAsset(asset: string) {
  return MARKETS.find((m) => m.asset.toLowerCase() === asset.toLowerCase());
}

export function marketByBaseAddress(address: string) {
  const t = tokenByAddress(address);
  return t ? MARKETS.find((m) => m.base === t.symbol) : undefined;
}
