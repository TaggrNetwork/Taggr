import { test, expect } from "@playwright/test";

test("Sanity check", async ({ page }) => {
    await page.goto("/");

    await expect(
        page.getByRole("heading", { name: "WELCOME ABOARD" }),
    ).toBeVisible();
    await expect(page).toHaveTitle("TAGGR");
    await expect(
        page.getByText("To the Future of Decentralized Social Networking"),
    ).toBeVisible();
});

test("Important links work", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("link", { name: "WHITE PAPER" }).click();
    await expect(
        page.getByRole("heading", { name: "WHITE PAPER" }),
    ).toBeVisible();
    await expect(
        page.getByRole("heading", { name: "Stalwarts" }),
    ).toBeVisible();
    await page.goBack();

    await page.getByRole("link", { name: "DASHBOARD" }).click();
    await expect(page.getByText("LAST UPGRADE")).toBeVisible();
    await page.goBack();
    await expect(page).toHaveTitle("TAGGR");
});
