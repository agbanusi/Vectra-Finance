import { expect, test } from "@playwright/test";

test("landing page links into the markets", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("One token.");
  await page.getByRole("link", { name: "Launch app" }).first().click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("heading", { name: "Markets" })).toBeVisible();
});

test("pages have no horizontal overflow on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/", "/app", "/app/portfolio"]) {
    await page.goto(path);
    const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    expect(sw, path).toBeLessThanOrEqual(cw);
  }
});
