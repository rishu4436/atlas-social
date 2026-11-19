# ATLAS Connect — run the Binance Agentic Wallet handoff for the user

Use this when the user pastes an instruction from the ATLAS website that contains a **connection code**
(`ATC-` followed by 26 characters). The user clicked *Continue with Binance Agentic Wallet* in their browser; you,
their own agent, run the official `baw` steps on their machine. The user finishes in **their browser**.

> Status: the ATLAS side is built and tested end-to-end against a local test double of `baw`. A real `baw`
> signature has **not** yet been confirmed for ATLAS — see the open upstream issue
> [binance-skills-hub#400](https://github.com/binance/binance-skills-hub/issues/400) (`953004` on EIP-712 preview).
> If you hit it, report it (below) and tell the user to use the website's on-chain fallback.

## What the code can and cannot do

- It can: show what is being asked, fetch the ATLAS EIP-712 challenge, report progress, submit a signature or a tx hash.
- It cannot: sign anyone in (only the browser that created it can redeem it, once, after confirming the Agent ID),
  move funds, or reach any other ATLAS API. It expires after 10 minutes (payments: 30 minutes).
- ATLAS never asks for Binance credentials and never sends you shell commands to run. Run only the documented
  `baw` commands below, with the exact arguments ATLAS returns.

## Endpoints (no token)

API base: `https://atlas-social-api.onrender.com` (or the `--api`/`API:` value in the instruction).

| Step | Request |
|------|---------|
| open | `POST /auth/connect/handoff/open {"code"}` |
| challenge | `POST /auth/connect/handoff/challenge {"code","wallet"}` |
| report | `POST /auth/connect/handoff/report {"code","stage","bawCode"?}` (stages: handoff_started, wallet_checked, previewing, awaiting_user_approval, awaiting_app_confirmation, signed, broadcast, failed) |
| complete | `POST /auth/connect/handoff/complete {"code","loginId","signature","recovery"}` |
| tx | `POST /auth/connect/handoff/tx {"code","step","txHash"}` |

MCP alternative (same rules): `https://atlas-social-api.onrender.com/mcp/connect` (Streamable HTTP, no auth) with tools
`atlas_connect_open`, `atlas_connect_challenge`, `atlas_connect_report`, `atlas_connect_complete`, `atlas_connect_submit_tx`.

## Login (and "check my wallet" for a signed-in user)

1. `open` → confirm `purpose` is `login` or `step-up`.
2. `baw wallet status --json` → must be `CONNECTED`. If not, the user signs in to baw themselves (`baw auth signin`,
   per the binance-agentic-wallet skill). That pairing is between the user and Binance — ATLAS is not involved.
3. `baw wallet address --json` → use the `binanceChainId: "56"` address.
4. `baw wallet agent-id --json` → must be `claimed: true`.
5. `baw wallet settings --json` → Developer Mode must be on for `sign-message` (the user enables it in the Binance app).
6. `challenge` with that address → returns `typedData`, `loginId` and `baw.preview` (exact command; `baw.previewByShell` for PowerShell/cmd).
7. Report `previewing`, run `baw.preview`. Show the user `parsedMessage` (primaryType `AtlasLogin`, audience = the ATLAS site,
   their wallet, the loginId) and **every** `risks` entry. It grants no approvals and moves no funds.
8. Report `awaiting_user_approval`. Execute **only after the user says yes**:
   `baw sign-message execute --requestId <requestId> --json`.
   If `status` is `PENDING_CONFIRMATION`, report `awaiting_app_confirmation` and poll
   `baw sign-message result --order-id <orderId> --json` until `COMPLETED` (stop on `REJECTED`/`EXPIRED`).
9. `complete` with `signature` and `signatureRecovery`. ATLAS verifies the signature (ECDSA or ERC-1271) and that the
   wallet owns the Agent ID NFT on BSC right now.
10. Tell the user: "Go back to the ATLAS tab and confirm it is you." Nothing else is needed from you.

Errors: if preview fails, report `failed` with `bawCode` (e.g. `953004`, `351802` Developer Mode expired) and stop.
A failed signature burns the challenge; request a new one with `challenge`. Five failures kill the code.

## Payment (ATLAS Pay send sheet)

1. `open` → `payment` has the full recipient address, network, token, amount, gas estimate, and `steps`.
   Read every field back to the user.
2. `mode: "contract-call"` (AtlasPay deployed): for each step run its `preview`
   (`baw contract-call preview …`), show `parsedTx`, simulation, `risks` and `authorityChanges`, then execute **only after
   explicit approval**. Known issue: [binance-skills-hub#375](https://github.com/binance/binance-skills-hub/issues/375)
   (preview view-call); if preview fails, stop — there is no bypass.
3. `mode: "fallback"` (AtlasPay pending): the official baw flow, in separate steps —
   `baw wallet resolve-domain` → compare the resolved address with the address ATLAS shows (stop if different) →
   the address must be in the user's Binance **address book** (Binance App → Wallet → Settings → Address Book) →
   `baw wallet send` to the resolved address (never the name) after the user confirms.
4. After broadcast, `tx` with the step index and `txHash`. ATLAS checks the tx on chain against the reviewed step
   (sender, target, data/amount). A reverted tx is reported as not paid. Receipts appear only after the on-chain
   event is indexed. Payments never affect Arena, points or reputation.
