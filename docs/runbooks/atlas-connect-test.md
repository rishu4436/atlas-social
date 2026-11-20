# Acceptance test: ATLAS Connect with a real Binance Agentic Wallet

Goal: prove that **"Continue with Binance Agentic Wallet"** works with a *real* `baw` and a real Agent ID on BSC (chain 56).

## Result log

| Date (IST) | baw | Agent ID | Result |
|---|---|---|---|
| 2026-11-19 ~20:50 | 1.12.0 | rishug4436.ai (`0xc44e…f0cF`) | **PASS.** Real Binance Agentic Wallet signed `AtlasLogin` twice, no 953004. The browser redeem completed sign-in and landed on `/home`. That account should have gone to profile setup; this is fixed, see PROGRESS "E2". |
| 2026-11-19 23:21–23:27 | 1.12.0 | rishug4436.ai (`0xc44e…f0cF`) | **PASS on mainnet contracts.** Connect login (companion → AtlasLogin preview → `yes` → redeem, existing account → `/home`), then the first real thesis: app `prepare` → `baw contract-call preview` (ThesisRegistry `publishThesis`, value 0, no risks) → execute → [`0xef2eb64f…`](https://bscscan.com/tx/0xef2eb64fbdf253f8532f2e2c6ffaa24b053178c3518fee796a26714ede9b1792) → thesis #1 published, indexed final, on the public profile. See [bsc-mainnet.md](../deployments/bsc-mainnet.md). |
| 2026-11-20 14:49–14:54 | 1.12.0 | minadevi.ai (`0xc37F…A43C`), second holder | **PASS.** New-account Connect login (companion, separate `baw` HOME) → redeem in its own cookie jar → `/welcome/profile` → profile saved. Then a real AtlasPay payment through the Connect pay handoff: 0.0001 BNB to rishug4436.ai, [`0x1ed148db…`](https://bscscan.com/tx/0x1ed148db4a717cc8ddbf2c50f42c942e6ac5497b7890a066bbc3aa4b1c97eaa2), stage Finalized · paid; and an on-chain review of thesis #1, [`0x4b067395…`](https://bscscan.com/tx/0x4b067395dd208c74a7314d741f261812e678be486aaa189a717bdcd386bac38a). See [bsc-mainnet.md](../deployments/bsc-mainnet.md). |

Status: **confirmed with baw 1.12.0 on Nov 19, 2026.** Re-run this test for new `baw` versions.

- Known upstream issue: [binance-skills-hub#400](https://github.com/binance/binance-skills-hub/issues/400) (open).
  It reports error 953004 from EIP-712 `sign-message preview`, filed against a *different* app's EIP-712 login (SOLVD),
  not ATLAS. Still open upstream; not hit in the Nov 19 acceptance run.
- Contract-call preview issue: [#375](https://github.com/binance/binance-skills-hub/issues/375).

**You** run every `baw` command, or your own agent does, on your machine. ATLAS never asks for Binance credentials,
keys or seed phrases, and never shows a QR code or pairing code.

## 0. Prerequisites (same as [agent-id-signin-test.md](agent-id-signin-test.md))

1. Install the CLI: `npm i -g @binance/agentic-wallet` (Node.js 20+).
2. Check the wallet: `baw wallet status --json` → `CONNECTED`. If it is not connected, run `baw auth signin` and finish Binance's sign-in in the Binance App.
3. Check the Agent ID: `baw wallet agent-id --json` → `"claimed": true`.
4. Turn on Developer Mode: in the App, Agentic Wallet → Settings → Developer Mode. `baw wallet settings --json` should show `devMode.enabled: true`.
5. Have one of these ready:
   - an AI agent with the Binance Agentic Wallet skill; **or**
   - a checkout of this repo for the companion (`git clone https://github.com/rishu4436/atlas-social && cd atlas-social && pnpm install`). The companion is a **preview, pending dedicated security review**.

## 1. New-browser sign-in (main test)

> **On a phone?** Open the site on the phone, tap Continue, then run the code on the computer or AI agent where `baw` is signed in. Finish (confirm) on the phone. The page says this under **How this works**.
> **First request slow?** The free-tier API sleeps. The site pings `/health` when `/welcome` loads and shows "Waking up ATLAS servers… (up to a minute)" while it retries; it never shows a raw parse error.
> **Developer Mode off** (`351802`): the companion stops and the browser shows "Developer Mode is off. Turn on Developer Mode in Binance App → Agentic Wallet → Settings, then run the code again."

1. Open https://atlas-social-web.vercel.app/welcome in a private window. Click **Continue with Binance Agentic Wallet**.
   - Expected: a code `ATC-…` (26 characters), a 10:00 countdown and "Waiting for your agent or terminal…".
2. Choose **one** of the tabs:
   - **Your AI agent:** copy the instruction and paste it into your agent.
   - **Terminal:** copy `npx tsx tools/atlas-baw-connect/src/cli.ts login ATC-…` and run it in the repo checkout. No `--api` is needed for production.
   - **MCP:** add the `/mcp/connect` server config to your MCP client, then ask it to run the ATLAS Connect login with the code.
3. Watch the browser. The stepper should move through *Hand off → Wallet detected → Approve in wallet*, driven by the reported stages.
4. Check the preview the agent or companion shows you:
   - `primaryType` is `AtlasLogin`, domain `ATLAS Social`, audience `https://atlas-social-web.vercel.app`;
   - it shows your wallet and a loginId;
   - there is no Permit, spender or token amount.
   Read every `risks` entry. Answer **yes** only if all of that is right.
   - If the Binance App asks for confirmation (`PENDING_CONFIRMATION`), approve it there. The companion polls `sign-message result`.
5. Expected: the browser shows your `name.ai` and full wallet address with "Is this you?". Click **Continue as name.ai** (or **Not me** to cancel).
   - **New account** → `/welcome/profile` (set display name and bio). **Existing account** → `/home`, with the same followers, points and reputation.
6. Open Settings → Security → **Identity & wallet**:
   - "Agent ID verified" shows your name and wallet;
   - "Agentic Wallet available" shows *Checked via ATLAS Connect sign-in* with a 10-minute countdown;
   - "Financial actions" shows *per transaction*.
   - After 10 minutes the wallet card must say it is *not* currently available, while you stay signed in.

**Record:**
- date and time (IST);
- your `baw --version`;
- the shell or agent you used;
- the result of each step;
- on failure, the full JSON error, with addresses redacted if you wish.

PASS means step 5 completes with a real signature. Only then may "works with real baw" be stated anywhere.

## 2. If preview fails with 953004 (#400)

- The browser shows the fallback card: "Known upstream issue binance-skills-hub#400", with a link to the on-chain proof.
- Use **Advanced options → guided CLI wizard**, or the **on-chain proof** (`registerIdentity`, a little BNB for gas), as in [agent-id-signin-test.md](agent-id-signin-test.md) Path B.
- Add a comment to #400 with the ATLAS reproduction only if you choose to; ATLAS posts nothing.

## 3. Negative checks (must all fail safely)

1. **Second browser:** copy the code into another browser or profile. It has no way to redeem; the poll returns `CONNECT_WRONG_BROWSER`.
2. **Replay:** after redeeming, reloading or re-submitting gives `CONNECT_ALREADY_USED`, and no second session is created.
3. **Expiry:** let the countdown reach 0. Submitting the signature gives `CONNECT_EXPIRED`.
4. **Decline:** answer `no` at the approval prompt. The output is "Cancelled. Nothing was signed or sent." and the browser stays at the approval stage.
5. **Wrong wallet:** sign with a wallet that does not hold the Agent ID. The result is `NOT_AGENT_ID_HOLDER` or a signer mismatch.

## 4. Wallet check (step-up)

While signed in, trigger any action that asks for a wallet check, or use **Check wallet now** in Settings → Security → Identity & wallet. The step-up dialog opens.
**Agentic Wallet** is the default tab. Run the same flow; the code is bound to *this session*.

Expected: "Agentic Wallet available — checked via ATLAS Connect wallet check".

## 5. Payment (optional, small real amount, your own funds)

AtlasPay is deployed on BSC (`0x4255…007E`), so the handoff is a `contract-call` (`payNative`, or exact `approve` then `payToken` for USDT); the `baw` fallback below applies only while AtlasPay is pending. Confirmed with a real 0.0001 BNB payment on 2026-11-20 (result log above).

1. Open `/pay`, choose a recipient `name.ai` and a small amount, then **Hand off to my Agentic Wallet**.
   The sheet shows the full address, network, token, amount, fee and risks.
2. Run `npx tsx tools/atlas-baw-connect/src/cli.ts pay ATC-…`, or the agent prompt. The flow is:
   - `wallet resolve-domain`;
   - it must match the address ATLAS shows, otherwise stop;
   - the address must be in your Binance address book;
   - **yes**;
   - `wallet send`.
3. Expected:
   - the sheet shows "Broadcast verified against the reviewed transfer" only after ATLAS checks the tx (`from`, `to`, amount);
   - a receipt appears only once the chain event is indexed;
   - Arena and points do not change.

The ATLAS backend never holds a `baw` session or moves funds. Receiving needs no login.
