# ATLAS Connect: security design

"Continue with Binance Agentic Wallet" is a **browser-first** handoff. The browser starts it and is the only party
that can finish it. The user's own agent, terminal or MCP client runs the official Binance Agentic Wallet (`baw`) steps
on the user's machine and only *submits a proof*.

Status: built and tested end to end against a labelled local test double of `baw`. A real `baw` signature for ATLAS
has **not** been confirmed yet. See [binance-skills-hub#400](https://github.com/binance/binance-skills-hub/issues/400):
error 953004 on EIP-712 `sign-message preview`, reported against a different app's EIP-712 login (SOLVD), not
ATLAS. Contract-call preview issue: [#375](https://github.com/binance/binance-skills-hub/issues/375). Acceptance test:
[../runbooks/atlas-connect-test.md](../runbooks/atlas-connect-test.md).

## Flow

```
Browser                       ATLAS API                         User's agent / terminal (baw)
POST /auth/connect/intents ─▶ intent (hashes only)  ◀── code ── user pastes instruction
 ◀─ code + Set-Cookie (httpOnly verifier)
GET /:id (poll, cookie) ────▶ status/stage            ◀── handoff/open, report(stage)
                                                      ◀── handoff/challenge {wallet} → EIP-712 AtlasLogin
                                                            baw sign-message preview → risks → user "yes"
                                                            → execute (→ result if app confirmation)
                                                      ◀── handoff/complete {signature}
                              verify sig (ECDSA / ERC-1271) + Agent ID NFT ownership on BSC → approved
"Confirm it's you: <agent>" ▶ POST /:id/redeem {confirmAgentName} (cookie) → session (one time)
```

## Controls

| Threat | Control |
|---|---|
| Agent or companion mints a session for another browser | Sessions are created only by `POST /auth/connect/intents/:id/redeem`, which needs the **browser verifier** (128-bit random) held in the `atlas_connect_<purpose>` cookie: httpOnly, SameSite=Strict, first-party via the `/api` rewrite. The verifier never appears in a response body, the code or the handoff. Handoff routes can only report progress and submit a proof. |
| Leaked or phished code (an attacker's wallet signs the victim's code) | The browser must confirm the proven Agent ID name (`confirmAgentName` must equal it) before redeeming. The approved card shows the agent name and full wallet. A mismatch → `CONNECT_AGENT_MISMATCH`. |
| Replay | Redemption is single-use (status `approved → redeemed` in one conditional UPDATE). Challenges are single-use (`consumeChallenge`). Duplicate tx hashes → `TX_ALREADY_REPORTED`. |
| Expiry | 10 min for login/step-up, 30 min for pay. The challenge has its own short expiry, and the EIP-712 message carries a nonce and expiry. |
| Brute force or guessing | Code is `ATC-` + 26 Crockford base32 characters (128 bits). Max 5 failed proofs, then the intent fails. Route rate limits per IP. |
| DB leak | Code and verifier are stored only as SHA-256 hashes. `connect_intents` has RLS, and `REVOKE ALL FROM atlas_app` is re-applied after generic grants (tested). |
| Cross-purpose signatures | Challenge purpose `connect` is rejected at `/auth/verify` and vice versa. The EIP-712 domain, loginId and audience are checked. |
| Smart-contract wallets | ERC-1271 `isValidSignature` is verified on chain (tested with a magic-value contract). |
| Wallet does not own the Agent ID | Ownership of the Agent ID NFT (BSC `0x60b9262456de011f7d15a54cdd8c48baaa8b022f`) is checked at proof time. "Wrong owner" is rejected. One Agent ID per account is preserved. |
| Session riding (step-up / pay) | Step-up and pay intents are bound to the creating `session_id` → `CONNECT_WRONG_SESSION`. |
| Account takeover by re-linking | Shared `linkOrCreateAccount` (same as `/auth/verify`): an existing wallet keeps its account, followers, points and reputation. A new wallet goes to `/welcome/profile`. |
| Status oracle | The `report` route accepts only an enumerated stage list and a numeric `bawCode`. No free text is rendered. |

**Not implemented on purpose:** QR or pairing-code login, where a device that is not the browser could create the session.
Passkeys, the manual CLI wizard (now under "Advanced options") and the on-chain `registerIdentity` proof all remain.

## Three separate states

`GET /auth/session` → `states`:

1. **Agent ID verified:** the account's identity, proven at sign-in.
2. **Agentic Wallet available:** time-limited (10 min) and per session. Set only by a fresh proof (`wallet_check_source`
   ∈ connect, connect-step-up, signature, step-up, onchain). An old session never implies the wallet is connected now.
3. **Financial action authorized:** always per transaction. `standingAuthorization: false`. ATLAS holds no `baw` session.

## Payments

`POST /pay/handoff` creates a 30-minute pay intent bound to the session. The handoff exposes the full recipient address,
network, token, amount, gas estimate and the exact steps.

- **contract-call mode** (AtlasPay deployed): `baw contract-call preview` → user approval → `execute`.
- **fallback mode** (AtlasPay not deployed on BSC, the current production state): `resolve-domain` → compare with the
  registry address → address book → `wallet send`.

ATLAS verifies each reported tx on chain against the reviewed step (`from`, `to`, `input`/`value`; for fallback, a native
transfer or ERC-20 `transfer(expected, amount)`). Reverted → `TX_REVERTED`. Receipts come only from indexed chain events.
Payments never touch Arena, points or reputation. Receiving needs no login.

## Companion (`tools/atlas-baw-connect`)

**Preview, pending dedicated security review. Not published.**

- No server, no port.
- `execFile` with an allowlist of `baw` subcommands, `shell: false`.
- All values are validated.
- Signs only `AtlasLogin` for this wallet, loginId and site.
- Typed `yes` approval.
- Never handles Binance credentials.
- API URL must be https (or localhost).

See its README.

## Tests

- `apps/api/test/connect.test.ts` (18): new and existing user, ERC-1271, replay, expiry, wrong browser or forged
  verifier, leaked-code name mismatch, wrong owner, signature mismatch and lockout, superseded intents, hashed storage
  and app-role denial, step-up states and session binding, pay contract-call (revert), foreign tx, duplicate, fallback
  transfer, MCP.
- `packages/auth/test/connect.test.ts` (6).
- `tools/atlas-baw-connect/test/companion.test.ts` (12).
- `tests/e2e/connect.spec.ts` (4 desktop + 1 mobile).
- Screenshots: `docs/evidence/screenshots/connect/`.
