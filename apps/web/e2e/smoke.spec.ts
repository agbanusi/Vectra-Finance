import { expect, test } from "@playwright/test";

test("landing page links into the app", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("one index token");
  await page.getByRole("link", { name: "Launch app" }).first().click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("heading", { name: "Explore indexes" })).toBeVisible();
});
