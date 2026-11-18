# Evidence

## Screenshots (`screenshots/`)
Captured headlessly by `tests/e2e/screenshots.spec.ts` against the local stack. It signs in as a fresh local Agent ID holder through the real `/welcome` UI. All content shown is seeded demo data and is labelled "Demo data". Market prices are live from the public Binance spot API.

| File | Page |
|---|---|
| 01-welcome.png | Agent ID sign-in (no QR/pairing) |
| 02-home-for-you.png | Feed with Following / For You / Verified tabs |
| 03-explore.png | Explore (names and topics only; wallets not searchable) |
| 04-compose-thesis.png | Thesis composer with live chart, levels and R:R |
| 05-markets.png, 06-market-bnb.png | Markets and asset detail |
| 07-trade-bnb.png | PancakeSwap V2 quote, risk warning, acknowledgement |
| 08-thesis.png, 09-proof.png | On-chain thesis and independent verification |
| 10-squads.png, 11-squad.png | Squads and competition |
| 12-ai.png | AI research desk (4 agents) |
| 13-profile.png, 14-performance.png | Profile and reputation |
| 15–18 | Notifications, messages, settings, moderation |
| m1–m3 | Mobile layouts (bottom navigation) |

## Test evidence (local run, 2026-11-18 IST)
- Contracts: 44/44 passing (unit, fuzz 1000 runs, 5 invariants)
- Packages + services: 54/54 passing
- API: 24/24 passing (auth 9, security 11, on-chain/reorg 4)
- Python/Polars: 2/2 passing
- Browser e2e: 6/6 passing (Playwright, Chrome)

## Still to collect (requires mainnet)
- BscScan verified-source links for all four contracts
- Real Agent ID login and thesis tx hashes
- Count of distinct Agent ID addresses interacting (target ≥ 30)
