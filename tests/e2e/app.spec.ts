import { test, expect } from "@playwright/test";
import { newHolder, loginViaUi } from "./helpers";

test("guest can browse feed, markets and proofs; no QR/pairing login exists", async ({ page }) => {
  await page.goto("/welcome");
  await expect(page.getByRole("heading", { name: /verify/i })).toBeVisible();
  await expect(page.getByText(/qr code|pairing code/i).filter({ hasNotText: /no QR or pairing-code login/i })).toHaveCount(0);
  await page.goto("/home");
  await expect(page.getByRole("tab", { name: "For You" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("article").first()).toBeVisible();
  await page.getByRole("tab", { name: "Verified" }).click();
  await expect(page.getByRole("tab", { name: "Verified" })).toHaveAttribute("aria-selected", "true");
  await page.goto("/trade/BNB");
  await expect(page.getByRole("note")).toContainText(/risky/i);
});

test("Agent ID holder signs in, posts, and sees it in the chronological feed", async ({ page }) => {
  const h = await newHolder();
  await loginViaUi(page, h);
  await page.goto("/compose");
  await page.getByRole("tab", { name: "Post" }).click();
  const stamp = `e2e post ${Date.now()}`; const body = `${stamp} #bnb`;
  await page.getByPlaceholder(/what are you seeing/i).fill(body);
  await page.getByRole("button", { name: /^post$/i }).click();
  await page.waitForURL("**/home");
  await page.getByRole("button", { name: /chronological/i }).click();
  await expect(page.getByText(stamp)).toBeVisible();
});

test("trade page requires risk acknowledgement and never offers server-side execution", async ({ page }) => {
  const h = await newHolder();
  await loginViaUi(page, h);
  await page.goto("/trade/BNB");
  const prepare = page.getByRole("button", { name: /prepare unsigned transaction/i });
  await expect(prepare).toBeDisabled();
  expect(await page.request.post("/api/trade/execute", { data: {} }).then((r) => r.status())).toBe(404);
});
