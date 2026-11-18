# Runbook: local development

1. `pnpm install`
2. Chain: `anvil` (chain 31337). Deploy with the anvil dev key (local only):
   ```bash
   export DEPLOYER_PRIVATE_KEY=$(cast wallet private-key --mnemonic "test test test test test test test test test test test junk" --mnemonic-index 0)
   cd packages/contracts && forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast && unset DEPLOYER_PRIVATE_KEY
   ```
   This writes `packages/contracts/deployments/31337.json` and deploys a **clearly labelled `MockAgentID`** (dev only; production uses the official registry `0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F`).
3. Postgres on `:5433` (`scripts/pg.sh start`, or docker compose). TimescaleDB is optional: migration 002 turns `candles` into a hypertable only if the extension exists.
4. Seed demo data (refuses chain 56; every post is flagged `simulated` and labelled "Demo data"):
   `cd apps/api && set -a && . ./.env.example && set +a && npx tsx src/db/seed.ts --reset`
5. API: `nohup scripts/api.sh > /tmp/api.log 2>&1 &` → http://localhost:4000/docs
6. Web: `scripts/web.sh` → http://localhost:3000. Admin: `cd apps/admin && NODE_ENV=production npx next build && npx next start -p 3001`
7. To sign in locally, create a holder on the mock registry (`MockAgentID.register("name")`) from any anvil account, then sign the challenge. `tests/e2e/helpers.ts` shows the full flow.

Optional env (see `apps/api/.env.example`):
- `REDIS_URL` enables BullMQ for notifications; otherwise an in-process queue is used.
- `STORAGE_DRIVER=s3` + `S3_*` for MinIO/S3.
- `AI_API_KEY`/`AI_BASE_URL`/`AI_MODEL` for an OpenAI-compatible narrator.
- `MESSAGE_KEY` (32 bytes base64) for at-rest DM encryption. Without it, an ephemeral dev key is used and messages are lost on restart.

Never commit `.env` files or keys. `.gitignore` excludes them.
