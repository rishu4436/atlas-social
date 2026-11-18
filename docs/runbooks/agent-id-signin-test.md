# Test procedure: real Agent ID sign-in with the Agentic Wallet (`baw` external-sign)

Goal: prove that a real Agent ID holder can sign in to ATLAS with their own Agentic Wallet, both through the EIP-712 signature path and through the on-chain fallback, and that nothing on ATLAS asks for a QR code, pairing code, seed phrase or key.

Run this against the production deployment (chain 56). It cannot run on the local mock, because the Agentic Wallet signs for real chains only. **The tester runs every `baw` command on their own machine. ATLAS never runs them.**

## Prerequisites (tester)
1. Binance App with an Agentic Wallet that has **claimed an Agent ID** (App → Web3 wallet → Agent ID). Check with `baw wallet agent-id --json`, which should show `Claimed: Yes` and `alice.ai`.
2. The CLI: `npm i -g @binance/agentic-wallet`, signed in to *your own* wallet (`baw auth signin`, done inside Binance's own flow, not on ATLAS), and `baw wallet status --json` shows it is connected.
3. **Developer Mode on**: App → Agentic Wallet → Settings → Developer Mode → accept the risk warning. Then `baw wallet settings --json` must show `devMode.enabled: true` with a future `expiresAt`. The wallet balance must be under the Developer Mode cap, or enabling fails with `351804`.
4. For path B only: a little BNB for gas (one `registerIdentity` call).
5. Your BSC address: `baw wallet address --json`.

## Path A: EIP-712 signature (preferred)
1. Open `https://<atlas>/welcome`, paste your Agent ID wallet address and click **Continue**.
   - Expected: the card shows your `name.ai`. A wallet without an Agent ID gets "This wallet does not hold an Agent ID".
2. Copy **1 · preview** and run it. It is a `baw sign-message preview --binanceChainId 56 --signType EIP712 --message '{"method":"eth_signTypedData_v4","params":["0xYou","{…AtlasLogin…}"]}' --json`.
   - Check `parsedMessage`: domain name **ATLAS Social**, chainId 56, `primaryType` AtlasLogin, the ATLAS audience/origin, a nonce, and an expiry about 5 minutes out. There must be **no** Permit, spender or token amounts.
   - Check `risks` and do not continue if it is intercepted.
3. `baw sign-message execute --requestId <requestId> --json`
   - `COMPLETED` → copy `signature` and `signatureRecovery`.
   - `PENDING_CONFIRMATION` → approve in the Binance App, then run `baw sign-message result --order-id <orderId> --json` until it is `COMPLETED`.
4. Paste the signature (with or without 0x) and the recovery value (e.g. `01`) into ATLAS, then click **Verify signature**.
   - Expected: a "Agent ID verified" reveal, redirect to `/home`, and your profile at `/u/<name>.ai`.
5. Negative checks (must all fail safely):
   - Paste the same signature again after logout. Expected: `ALREADY_USED`.
   - Wait more than 5 minutes before verifying. Expected: `EXPIRED`.
   - Sign the challenge with a different wallet. Expected: rejected.

> Known issue: Agentic Wallet issue #400. `sign-message preview` for EIP-712 may fail with **953004**. If that happens, record the full JSON error in the test log and use Path B.

## Path B: on-chain identity proof (fallback, counts as a contract interaction)
1. On the sign-in card, choose **On-chain proof**.
2. Run **check Developer Mode**, then the **preview**: `baw contract-call preview --binanceChainId 56 --from <you> --to <AtlasIdentityRegistry> --value 0 --inputData 0x… --json`.
   - Check that `parsedTx` calls `registerIdentity(bytes32)` on the ATLAS Identity Registry address shown on `/config` and on BscScan. Value must be 0, with no approvals and no `authorityChanges`.
3. `baw contract-call execute --requestId <id> --json` → `BROADCASTED` with a `txHash` (or approve in the App if `PENDING_CONFIRMATION`).
4. Back on ATLAS, click **I've sent it — verify**. Expected: signed in. The tx is visible on BscScan from your address.
5. Negative: replaying the same commitment is rejected on-chain (`commitmentReplay`) and by the API.

## Also verify
- Settings → Security lists exactly one session for this device. "Sign out everywhere" revokes it.
- Adding a passkey requires a fresh wallet proof (step-up). Passkey sessions cannot publish theses or prepare trades without a new wallet proof.
- No page anywhere shows a QR code, pairing code or seed-phrase field.

## Record (paste into docs/evidence/real-signin.md)
Date/time (IST), tester `name.ai`, wallet (only if the tester agrees to publish it), path A result or error JSON, path B tx hash + BscScan link, and screenshots of the preview output (redact nothing sensitive, because there should be nothing sensitive in it).
