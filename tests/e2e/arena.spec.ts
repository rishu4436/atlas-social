import { test, expect } from "@playwright/test";
import { newHolder, loginViaUi } from "./helpers";

test("Arena: tabs, windows, honest Gainers/Points/Squads states, Proof Drawer, sorting, comparison", async ({ page }) => {
  await page.goto("/performance");
  await page.waitForURL("**/arena**");
  await expect(page.getByRole("heading", { name: "Arena", level: 1 })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Analysts", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("arena-meta")).toContainText(/atlas-skill-v2 v2 · provisional/);
  await expect(page.getByTestId("arena-meta")).toContainText(/Finalized block/);
  // audit F2: verified (Final on-chain only) by default; Provisional is a separate, clearly labelled view
  await expect(page.getByTestId("arena-basis")).toContainText("Verified · Final on-chain only");
  await page.getByTestId("basis-toggle").getByRole("radio", { name: "Provisional" }).click();
  await expect(page).toHaveURL(/basis=provisional/);
  await expect(page.getByTestId("provisional-banner")).toContainText(/not verified/);
  await expect(page.getByTestId("arena-basis")).toContainText("Provisional · not verified");
  await page.getByTestId("basis-toggle").getByRole("radio", { name: "Verified" }).click();
  await expect(page.getByTestId("provisional-banner")).toBeHidden();

  const rows = page.getByTestId("arena-table").getByTestId("arena-row");
  if ((await rows.count()) === 0) {
    await expect(page.getByTestId("arena-empty")).toContainText(/Verified rankings will appear here/);
  } else {
    // sortable columns
    const res = page.getByRole("columnheader", { name: /Res\./ }).first();
    await res.getByRole("button").click();
    await expect(res).toHaveAttribute("aria-sort", "descending");
    // Proof Drawer explains the rank
    await rows.first().getByRole("button", { name: /Why is/ }).click();
    const drawer = page.getByTestId("proof-drawer");
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText("Score components");
    await expect(drawer).toContainText("Statistically adjusted success");
    await expect(drawer).toContainText("Thesis Return Drawdown");
    await expect(drawer).toContainText(/not realized P&L/);
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    // Trader Comparison Lab
    const boxes = page.getByTestId("arena-table").getByRole("checkbox");
    if ((await boxes.count()) >= 2) {
      await boxes.nth(0).click(); await boxes.nth(1).click();
      await page.getByRole("button", { name: /^Compare$/ }).click();
      await expect(page.getByTestId("compare-lab")).toContainText("Realized trading P&L");
      await page.keyboard.press("Escape").catch(() => {});
      await page.mouse.click(5, 5);
    }
  }

  // methodology keeps the original Performance view
  await page.getByRole("button", { name: /Methodology/ }).click();
  await expect(page.getByTestId("methodology")).toContainText("Skill Score v2");
  await expect(page.getByTestId("methodology")).toContainText("Reputation v1");
  await page.mouse.click(5, 5);

  // 24h warns about insufficient evidence
  await page.getByRole("radio", { name: "24h" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /Insufficient evidence/ })).toBeVisible();
  await page.getByRole("radio", { name: "All" }).click();

  await page.getByRole("tab", { name: "Gainers" }).click();
  await expect(page.getByTestId("gainers-tab")).toContainText("Verified realized P&L coming in Arena 2.0");
  await expect(page.getByTestId("gainers-tab")).toContainText(/not money earned/i);

  await page.getByRole("tab", { name: "Points" }).click();
  await expect(page.getByTestId("points-tab")).toContainText(/not a token, not cash and not an airdrop/);
  await expect(page.getByTestId("xp-rules")).toContainText("Trading volume or transaction count");

  await page.getByRole("tab", { name: "Squads" }).click();
  await expect(page.getByTestId("squads-tab")).toContainText("Arena 3.0");
});

test("Arena Points: a signed-in Agent ID holder sees XP from the ledger, level and achievements", async ({ page }) => {
  const h = await newHolder("arena");
  await loginViaUi(page, h);
  await page.goto("/arena?tab=contributors");
  const pts = page.getByTestId("points-tab");
  await expect(pts).toContainText("Level");
  await expect(pts).toContainText("Agent ID onboarding");
  await expect(page.getByTestId("achievement").filter({ hasText: "Founding Agent ID" })).toBeVisible();
  // the profile shows the Arena section and achievements
  await page.goto(`/u/${h.agentName}`);
  await page.getByRole("tab", { name: "Arena" }).click();
  await expect(page.getByTestId("profile-arena")).toContainText("ATLAS Points");
});

test("Arena on mobile uses stacked cards and never scrolls horizontally @mobile", async ({ page }) => {
  await page.goto("/arena?window=all");
  await expect(page.getByRole("heading", { name: "Arena", level: 1 })).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(page.getByTestId("arena-table")).toBeHidden();
  const cards = page.getByTestId("arena-cards").getByTestId("arena-card");
  if (await cards.count()) {
    await cards.first().click();
    await expect(page.getByTestId("proof-drawer")).toBeVisible();
    await page.getByRole("button", { name: "Close proof drawer" }).click();
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
