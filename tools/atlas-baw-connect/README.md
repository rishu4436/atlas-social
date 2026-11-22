# atlas-social-connect

One command to connect to [ATLAS Social](https://atlascalls.xyz). It installs anything missing
(the official Binance Agentic Wallet CLI, `baw`), signs you in with **Binance's official** QR if
needed, and previews the ATLAS login. A standard official login (ATLAS Social v1 on atlascalls.xyz, no risks reported) is signed automatically; pass `--confirm` to review and type `y` first. Payments always require `y`.

You do not need to clone this repository.

## Commands

macOS / Linux:

```bash
curl -fsSL https://atlascalls.xyz/connect.sh | sh -s ATC-XXXXXXXXXXXXXXXXXXXXXXXXXX
```

Windows (PowerShell):

```powershell
iex "& { $(irm https://atlascalls.xyz/connect.ps1) } ATC-XXXXXXXXXXXXXXXXXXXXXXXXXX"
```

If you already have Node.js 18+:

```bash
npx --yes atlas-social-connect@latest login ATC-XXXXXXXXXXXXXXXXXXXXXXXXXX
```

Payment handoff uses `pay` instead of `login` (the website shows the exact command).

## What it does

1. If `baw` is missing, installs `@binance/agentic-wallet` globally with npm (Binance's official package) and shows what it installed.
2. Checks whether `baw` is signed in with `baw wallet status --json` (and `baw wallet address --json` if needed). There is no `baw auth status`.
3. If you are not signed in, runs official `baw auth signin` and shows Binance's own login page / pairing code, then waits on `baw auth verify`. ATLAS never invents a QR.
4. Fetches the ATLAS EIP-712 challenge for your connection code.
5. Runs `baw sign-message preview` and prints a short summary (type, domain, site, wallet, expiry, and every reported risk).
6. If it is a standard ATLAS Social v1 login for the official site (`https://atlascalls.xyz`, or `--origin`), the wallet matches, the message is the no-transaction statement, it is not expired, and `baw` reports no risks, it signs automatically. Otherwise it asks `[y/N]`. Pass `--confirm` to always ask. Payments, contract calls, approvals and transfers never auto-sign.
7. Then runs `baw sign-message execute` (only after the checks or your `y`) and posts the signature to ATLAS. You finish in the browser tab that showed the code.

## Guarantees (enforced in code and tested in `test/companion.test.ts`)

- **No server.** It never listens on a port, so no website can drive it.
- **No shell.** `baw` and `npm` run via `execFile` with a fixed argument vector (`shell: false`). Only an allowlist of documented subcommands can run (`wallet status|address|agent-id|settings|resolve-domain|send`, `auth signin|verify`, `sign-message preview|execute|result`, `contract-call preview|execute`). Nothing ATLAS returns is executed as a command; every value is validated first.
- **Signs only the ATLAS login.** It refuses any message that is not `AtlasLogin` from domain `ATLAS Social` for your wallet, this `loginId` and the ATLAS site.
- **Login may auto-sign only after a strict check.** A clean official `AtlasLogin` (domain `ATLAS Social` v1, chain 56, official origin, your wallet, the no-transaction statement, not expired, no `baw` risks) is signed without a prompt. Anything else falls back to `[y/N]`, or is refused. `--confirm` always prompts. **Payments, contract calls, approvals and transfers always require `y`.**
- **No credentials.** It never asks for, reads or sends Binance credentials, keys or seed phrases. `baw` keeps its own session.
- **Cannot sign you in elsewhere.** The connection code only lets it submit a proof. The website session is created only in the browser that showed the code, once, after you confirm your Agent ID there.
- Talks only to `https://atlas-social-api.onrender.com` (or `--api https://…` / `http://localhost` for development).

## Status

Tested end-to-end against a labelled **test double** of `baw` (`test/fake-baw.mjs`, local chain only, refuses
chain 56). Real `baw` sign-in for ATLAS was **confirmed with baw 1.12.0 on Nov 19, 2026** in the owner's acceptance
test (two AtlasLogin signatures, no 953004). Still open upstream (not hit):
[binance-skills-hub#400](https://github.com/binance/binance-skills-hub/issues/400) (953004 on EIP-712 preview)
and [#375](https://github.com/binance/binance-skills-hub/issues/375) (contract-call preview). Acceptance test:
[docs/runbooks/atlas-connect-test.md](../../docs/runbooks/atlas-connect-test.md).
