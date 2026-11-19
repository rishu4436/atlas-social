# atlas-baw-connect — PREVIEW, pending dedicated security review

A small local command-line companion that runs the **official Binance Agentic Wallet CLI (`baw`)** steps for an
ATLAS Connect code, so you do not have to copy commands by hand. It is **not published** to npm or any registry;
run it from a checkout of this repository.

```bash
git clone https://github.com/rishu4436/atlas-social && cd atlas-social && pnpm install
npx tsx tools/atlas-baw-connect/src/cli.ts login ATC-XXXXXXXXXXXXXXXXXXXXXXXXXX   # sign in / wallet check
npx tsx tools/atlas-baw-connect/src/cli.ts pay   ATC-XXXXXXXXXXXXXXXXXXXXXXXXXX   # ATLAS Pay handoff
```

The website shows the exact command with your code after you click **Continue with Binance Agentic Wallet**.

## What it does

Login: `baw wallet status` → `wallet address` (BSC) → `wallet agent-id` → `wallet settings` (Developer Mode) →
fetch the ATLAS EIP-712 challenge for the code → `baw sign-message preview` → prints the parsed message and every
risk → **you type `yes`** → `sign-message execute` (→ `sign-message result` while the Binance app waits for you)
→ posts the signature to ATLAS. You then confirm in the browser tab that showed the code.

Pay: prints the full recipient address, network, token, amount and fee estimate → per step
`baw contract-call preview` → risks → **`yes`** → `contract-call execute` → posts the tx hash, which ATLAS checks
on chain. While AtlasPay is pending it runs the official fallback instead: `wallet resolve-domain` → compare with
the address ATLAS read from the Agent ID registry (stops if different) → address-book reminder → **`yes`** →
`wallet send`.

## Guarantees (enforced in code and tested in `test/companion.test.ts`)

- **No server.** It never listens on a port, so no website can drive it.
- **No shell.** `baw` runs via `execFile` with a fixed argument vector (`shell: false`). Only an allowlist of
  documented subcommands can run (`wallet status|address|agent-id|settings|resolve-domain|send`,
  `sign-message preview|execute|result`, `contract-call preview|execute`). Nothing ATLAS returns is executed as
  a command; every value (addresses, calldata, amounts, request/order ids) is validated first.
- **Signs only the ATLAS login.** It refuses any message that is not `AtlasLogin` from domain `ATLAS Social` for
  your wallet, this `loginId` and the ATLAS site.
- **Explicit approval.** Nothing executes unless you type `yes` after the preview.
- **No credentials.** It never asks for, reads or sends Binance credentials, keys or seed phrases. `baw` keeps its
  own session; if `baw` is not signed in, you run `baw auth signin` yourself (that pairing is between you and
  Binance, not ATLAS).
- **Cannot sign you in elsewhere.** The connection code only lets it submit a proof. The website session is created
  only in the browser that showed the code, once, after you confirm your Agent ID there.
- Talks only to `https://atlas-social-api.onrender.com` (or `--api https://…` / `http://localhost` for development).

## Status

Tested end-to-end against a labelled **test double** of `baw` (`test/fake-baw.mjs`, local chain only, refuses
chain 56). Real `baw` sign-in for ATLAS was **confirmed with baw 1.12.0 on Nov 19, 2026** in the owner's acceptance
test (two AtlasLogin signatures, no 953004). Still open upstream (not hit):
[binance-skills-hub#400](https://github.com/binance/binance-skills-hub/issues/400) (953004 on EIP-712 preview)
and [#375](https://github.com/binance/binance-skills-hub/issues/375) (contract-call preview). Acceptance test:
[docs/runbooks/atlas-connect-test.md](../../docs/runbooks/atlas-connect-test.md).
