import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { newHolder, loginViaUi } from "./helpers";

// Arena evidence screenshots (local dev data is the labelled demo seed).
const OUT = `${process.env.SHOTS_DIR ?? "../../docs/evidence/screenshots"}/arena`;
mkdirSync(OUT, { recursive: true });

async function settle(page: Page) {
  await expect(page.getByRole("heading", { name: "Arena", level: 1 })).toBeVisible();
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(900);
}

test("capture Arena desktop screenshots", async ({ page }) => {
  const h = await newHolder("arshot");
  await loginViaUi(page, h);
  for (const [name, tab] of [["analysts", "analysts"], ["gainers", "gainers"], ["consistent", "consistency"], ["rising", "rising"], ["points", "contributors"], ["squads", "squads"]] as const) {
    await page.goto(`/arena?tab=${tab}&window=all`);
    await settle(page);
    await page.screenshot({ path: `${OUT}/desktop-${name}.png`, fullPage: true });
  }
  await page.goto("/arena?tab=analysts&window=90d");
  await settle(page);
  const rows = page.getByTestId("arena-table").getByTestId("arena-row");
  if (await rows.count()) {
    await rows.first().getByRole("button", { name: /Why is/ }).click();
    await expect(page.getByTestId("proof-drawer")).toBeVisible();
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/desktop-proof-drawer.png` });
    await page.keyboard.press("Escape");
    const boxes = page.getByTestId("arena-table").getByRole("checkbox");
    if ((await boxes.count()) >= 3) {
      for (const i of [0, 1, 2]) await boxes.nth(i).click();
      await page.getByRole("button", { name: /^Compare$/ }).click();
      await expect(page.getByTestId("compare-lab")).toBeVisible();
      await page.waitForTimeout(700);
      await page.screenshot({ path: `${OUT}/desktop-compare-lab.png` });
    }
  }
});

test("capture Arena mobile screenshots @mobile", async ({ page }) => {
  for (const [name, tab] of [["analysts", "analysts"], ["gainers", "gainers"], ["points", "contributors"], ["rising", "rising"]] as const) {
    await page.goto(`/arena?tab=${tab}&window=all`);
    await settle(page);
    await page.screenshot({ path: `${OUT}/mobile-${name}.png`, fullPage: true });
  }
  await page.goto("/arena?tab=analysts&window=90d");
  await settle(page);
  const cards = page.getByTestId("arena-cards").getByTestId("arena-card");
  if (await cards.count()) {
    await cards.first().click();
    await expect(page.getByTestId("proof-drawer")).toBeVisible();
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/mobile-proof-drawer.png` });
  }
});
