import { test } from "@playwright/test";
import pg from "pg";
import { mkdirSync } from "node:fs";
import { newHolder, loginViaUi } from "./helpers";

const OUT = process.env.SHOTS_DIR ?? "../../docs/evidence/screenshots";
mkdirSync(OUT, { recursive: true });

async function settle(page: any) { await page.waitForLoadState("load"); await page.waitForTimeout(2800); }

test("capture desktop screenshots", async ({ page, request }) => {
  test.setTimeout(300_000);
  await page.goto("/welcome"); await settle(page); await page.screenshot({ path: `${OUT}/01-welcome.png` });
  const h = await newHolder("judge");
  // grant moderator to this local demo account so the admin console has content (local dev DB only)
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL ?? "postgres://atlas@127.0.0.1:5433/atlas" });
  await loginViaUi(page, h);
  await db.connect();
  const [{ user_id }] = (await db.query(`SELECT user_id FROM profiles WHERE agent_name = $1`, [h.agentName])).rows;
  await db.query(`INSERT INTO user_roles (user_id, role) VALUES ($1, 'moderator') ON CONFLICT DO NOTHING`, [user_id]);
  await db.end();
  const thesis = (await (await request.get("/api/theses?limit=1")).json())[0];
  const shots: [string, string][] = [
    ["02-home-for-you", "/home"], ["03-explore", "/explore"], ["04-compose-thesis", "/compose"], ["05-markets", "/markets"],
    ["06-market-bnb", "/markets/BNB"], ["07-trade-bnb", "/trade/BNB"], ["08-thesis", `/thesis/${thesis.id}`], ["09-proof", `/proof/${thesis.id}`],
    ["10-squads", "/squads"], ["11-squad", "/squads/bnb-structure"], ["12-ai", "/ai"], ["13-profile", `/u/${thesis.author.agentName}`],
    ["14-performance", "/performance"], ["15-notifications", "/notifications"], ["16-messages", "/messages"], ["17-settings", "/settings"], ["18-admin", "/admin"],
  ];
  for (const [name, path] of shots) { await page.goto(path); await settle(page); await page.screenshot({ path: `${OUT}/${name}.png` }); }
});

test("capture mobile screenshots @mobile", async ({ page }) => {
  for (const [name, path] of [["m1-welcome", "/welcome"], ["m2-home", "/home"], ["m3-markets", "/markets/BNB"]]) { await page.goto(path); await settle(page); await page.screenshot({ path: `${OUT}/${name}.png` }); }
});
