import { test, expect } from "@playwright/test";
import { HomePage } from "../pages";

test("home page loads", async ({ page }) => {
    const homePage = new HomePage(page);

    await homePage.goto();

    await expect(homePage.welcomeAboardHeader).toHaveText("WELCOME ABOARD");
});
