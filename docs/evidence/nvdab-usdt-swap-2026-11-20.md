# Real swap through ATLAS Trade: NVDAB → USDT (2026-11-20)

Owner request (rishug4436.ai): convert all NVDAB to USDT using the ATLAS website's Trade flow.

- Wallet: rishug4436.ai `0xc44edDcFfA4227d38bc92a7cA5990953AA7Ff0cF`, signed in via ATLAS Connect (AtlasLogin EIP-712 through `baw`).
- Token: NVDAB `0x02Fca66C1D1aFB4E2A7884261eB00F63598a7436` — beacon proxy → SecuritiesToken (issuer compliance list, pause manager, ERC-8056 UI multiplier ≈ 1.00078; `balanceOf` is raw). Pre-checked on-chain: not paused; wallet, PancakeSwap V2 router and NVDAB/WBNB pair compliant.
- Route: PancakeSwap V2 NVDAB → WBNB → USDT (direct V2 NVDAB/USDT pair holds dust). Reference: PancakeSwap V3 0.25% NVDAB/USDT pool mid ≈ $142.49 → holding ≈ $12.35.
- Quote from `/trade/prepare`: expected 12.2849 USDT (99.45% of reference), price impact 0.10%, slippage 1% → minimum 12.1621 USDT, 20-minute deadline.
- Step 1 exact approve 0.086690905539934999 NVDAB to the router: [0xf982…8efe](https://bscscan.com/tx/0xf98200c5931ba51024a7d26a2c1cb9b9c21b692ae90e5b9ca04ba26ba28e8efe) (gas 54,444).
- Step 2 `swapExactTokensForTokens`, recipient = own wallet: [0x14c6…8737](https://bscscan.com/tx/0x14c6e9240c6e0dccf1d57f61f2262f93002ea88dede9be260dd90535de2f8737) (gas 219,810), block 134676596.
- Received 12.275340621244424778 USDT (99.4% of reference value; effective 141.60 USDT per raw NVDAB). Allowance back to 0. Gas total 0.0000237 BNB.
- `/trade/evidence`: VERIFIED (proof c3b9e138…, evidence hash 0x1b04b8cc…), not attached to a thesis, not shared to the feed.
