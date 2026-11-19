# Test procedure: real Agent ID sign-in with the Agentic Wallet (`baw` external-sign)

> The primary sign-in is now **ATLAS Connect** ("Continue with Binance Agentic Wallet"). Its acceptance test is [atlas-connect-test.md](atlas-connect-test.md). This page covers the **Advanced options** paths: the guided CLI wizard and the on-chain fallback. 953004 is tracked upstream as [binance-skills-hub#400](https://github.com/binance/binance-skills-hub/issues/400), filed against a different app's (SOLVD) EIP-712 login.

Goal: prove that a real Agent ID holder can sign in to ATLAS with their own Agentic Wallet, through the EIP-712 signature path and through the on-chain fallback, and that nothing on ATLAS asks for a QR code, pairing code, seed phrase or key.

**Decision (final):** first-time Agent ID verification uses the official Binance Agentic Wallet CLI (`baw`). Returning users sign in with a passkey. Authentication itself was not redesigned: EIP-712 challenge, single-use nonce, 5-minute expiry, website (audience) binding, ecrecover + ERC-1271, live Agent ID ownership check, one Agent ID per account, burned challenge on any rejected attempt, 20 attempts/min, no QR or pairing login.

Run this against the production deployment (chain 56). It cannot run on the local mock, because the Agentic Wallet signs for real chains only. **The tester runs every `baw` command on their own machine. ATLAS never runs them.**

- Guided wizard: `https://atlas-social-web.vercel.app/onboarding`
- Judge guide (what to check, every error explained): `https://atlas-social-web.vercel.app/onboarding/guide`
- Error catalog the UI uses: `https://atlas-social-web.vercel.app/api/auth/errors`

## Prerequisites (tester) — wizard step 1
1. CLI: `npm i -g @binance/agentic-wallet` (Node.js 20+). Windows: install Node.js LTS first (`winget install OpenJS.NodeJS.LTS`), then open a new terminal. macOS/Linux: if npm says `EACCES`, use nvm rather than `sudo`.
2. Connected to *your own* wallet: `baw wallet status --json`. If not, `baw auth signin` and finish Binance's own sign-in in the Binance App (between you and Binance, not on ATLAS).
3. Agent ID claimed: `baw wallet agent-id --json` → `"claimed": true` and your `name.ai`.
4. **Developer Mode on**: App → Agentic Wallet → Settings → Developer Mode → accept the risk warning. `baw wallet settings --json` must show `devMode.enabled: true` with a future `expiresAt`. The wallet balance must be under the Developer Mode cap, or enabling fails with `351804`.
5. Wallet address: `baw wallet address --json`.
6. For path B only: a little BNB for gas (one `registerIdentity` call).

The wizard has a paste box that reads any of these outputs **locally in the browser** and ticks the matching item (and fills the address).

## Path A: EIP-712 signature (preferred) — wizard steps 2–4
1. Open `/onboarding`, choose your shell (macOS/Linux/WSL, Windows PowerShell 7+, or Windows Command Prompt), enter the wallet and click **Generate my commands**.
   - Expected: your `name.ai` badge and a **5:00 countdown**. A wallet without an Agent ID gets `NOT_AGENT_ID_HOLDER` ("No Agent ID on this wallet" + how to claim one).
   - Windows PowerShell 5.1 mangles embedded quotes; use the Command Prompt tab or PowerShell 7.3+.
2. Copy **1 · Preview the login message** (it contains your loginId) and run it. Paste the output back.
   - The wizard checks the parsed message is *this* challenge: domain **ATLAS Social**, `primaryType` AtlasLogin, your wallet, the ATLAS audience, same chain, same loginId. Otherwise it shows `WRONG_MESSAGE` (do not execute), `CHAIN_MISMATCH` or `STALE_PREVIEW`.
   - Check yourself: no Permit, spender or token amounts; `risks` empty or harmless. If intercepted (`351803`), stop.
3. Copy **2 · Sign it**. The wizard has already filled in your `requestId`. Run it and paste the output.
   - `COMPLETED` → signature and recovery are filled in automatically.
   - `PENDING_CONFIRMATION` → approve in the Binance App; the wizard shows **3 · Fetch the signature** with your `orderId` filled in. Run it until `COMPLETED` and paste the output.
4. Click **Verify signature**.
   - Expected: "Agent ID verified", then an offer to **add a passkey**.
5. Add a passkey (optional). Then sign out and use **Sign in with a passkey** on `/onboarding` or `/welcome`. Expected: signed in with `method: passkey` (social access only).
6. Negative checks (must all fail safely):
   - Let the countdown reach 0: every command is struck through and marked **Stale · challenge expired**, copy buttons and Verify are disabled. **Generate new challenge** issues a new one and invalidates the old one server-side (`CHALLENGE_SUPERSEDED`). Optional "Auto-renew" does this automatically (max 3 times in a row).
   - Paste a truncated signature: flagged locally (`SIGNATURE_TRUNCATED`) before anything is sent.
   - Sign with a different wallet: `SIGNER_MISMATCH` showing the recovered vs expected address; the challenge is burned and a new one issued.
   - Replay a used signature: `ALREADY_USED`.

> Known issue: Agentic Wallet issue #400. `sign-message preview` for EIP-712 may fail with **953004**. Pasting that output shows "Known Agentic Wallet bug (#400, error 953004)" with a **Use the on-chain proof** button. Record the full JSON error in the test log and use Path B.

## Path B: on-chain identity proof (fallback, counts as a contract interaction)
Reached from any unrecoverable signing failure (`BAW_953004`, `ERC1271_REJECTED`, unknown `baw` error) or the "Signing keeps failing?" link.
1. **While contracts are not deployed** (current live beta): the panel says **Contracts pending deployment**, lists the steps greyed out, and has **no verify button**. Nothing is faked. Use Path A.
2. After deployment: run **1 · Check Developer Mode**, then **2 · Preview the registerIdentity call**: `baw contract-call preview --binanceChainId 56 --from <you> --to <AtlasIdentityRegistry> --value 0 --inputData 0x… --json`.
   - Check `parsedTx` calls `registerIdentity(bytes32)` on the ATLAS Identity Registry address shown on `/api/config` and BscScan. Value 0, no `allowanceChanges`, no `authorityChanges`.
3. Paste the preview output; **3 · Send it** gets your `requestId`. `BROADCASTED` with a `txHash` (or approve in the App if `PENDING_CONFIRMATION`).
4. Click **I've sent it — verify on-chain**. Before the tx confirms you get `PROOF_PENDING` with **Try again**. ATLAS reads the commitment on-chain; it does not trust a pasted hash.
5. Negative: replaying the same commitment is rejected on-chain (`commitmentReplay`) and by the API.

## Error codes (stable; full text at `/api/auth/errors` and `/onboarding/guide`)
| Situation | Code | Next action in the UI |
|---|---|---|
| Challenge expired | `EXPIRED` | New challenge (old commands stale) |
| Regenerated / old commands | `CHALLENGE_SUPERSEDED` | Use current commands |
| Used or burned | `ALREADY_USED` | New challenge |
| Wrong wallet signed / old challenge | `SIGNER_MISMATCH` (+ recovered/expected address) | New challenge issued automatically |
| No Agent ID | `NOT_AGENT_ID_HOLDER` | Claim one in the Binance App |
| Truncated / non-hex signature | `SIGNATURE_TRUNCATED` / `MALFORMED_SIGNATURE` | Re-copy (caught locally first) |
| Chain mismatch | `CHAIN_MISMATCH` | Run commands unchanged |
| baw bug #400 | `BAW_953004` (local) | On-chain proof |
| Smart wallet refused | `ERC1271_REJECTED` | On-chain proof |
| Rate limit | `RATE_LIMITED` (+ `retryAfterSeconds`) | Wait |
| Contracts not deployed | `CONTRACTS_PENDING` | Signature path only |
| Tx not found yet | `PROOF_PENDING` | Try again |
| Developer Mode off / cap / risk block | `BAW_DEV_MODE_OFF` / `BAW_DEV_MODE_BALANCE_CAP` / `BAW_RISK_BLOCKED` (local) | Enable in App / lower balance / stop |

## Also verify
- Settings → Security lists exactly one session for this device. "Sign out everywhere" revokes it.
- Adding a passkey requires a fresh wallet proof (step-up). Passkey sessions cannot publish theses or prepare trades without a new wallet proof.
- No page anywhere shows a QR code, pairing code or seed-phrase field.

## Record (paste into docs/evidence/real-signin.md)
Date/time (IST), tester `name.ai`, wallet (only if the tester agrees to publish it), shell used, path A result or error JSON, path B tx hash + BscScan link, and screenshots of the preview output (redact nothing sensitive, because there should be nothing sensitive in it).

## Automated coverage
- `packages/auth/test/onboarding.test.ts` — error catalog, signature pre-check, pasted `baw` output parsing (incl. 953004, 3518xx, stale/foreign previews, shell-injection-safe IDs), per-shell quoting round-trips.
- `apps/api/test/onboarding.test.ts` — challenge timing, status, regenerate/supersede, EXPIRED, SIGNER_MISMATCH, truncated/malformed, CHAIN_MISMATCH, real ERC-1271 refusal on anvil, PROOF_PENDING, CONTRACTS_PENDING, rate limit, catalog.
- `tests/e2e/onboarding.spec.ts` — desktop + mobile wizard, expiry/stale/regenerate, auto-renew, error states, real local-chain fallback, contracts-pending fallback, passkey add + passkey sign-in, judge guide. Screenshots: `docs/evidence/screenshots/onboarding/`.
