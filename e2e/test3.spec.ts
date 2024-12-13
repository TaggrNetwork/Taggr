import { test, expect, Page } from "@playwright/test";
import { resolve } from "node:path";
import { exec } from "./command";

test.describe.configure({ mode: "serial" });

test.describe("Regular users flow, part two", () => {
    let page: Page;

    test.beforeAll(async ({ browser }) => {
        page = await browser.newPage();
    });

    test("Registration", async () => {
        await page.goto("/");

        // Registration flow
        await page.getByRole("button", { name: "CONNECT" }).click();
        await page.getByRole("button", { name: "PASSWORD" }).click();
        await page.getByPlaceholder("Enter your password...").fill("john");
        await page.getByRole("button", { name: "JOIN" }).click();
        await page.waitForTimeout(1000);
        await page.getByPlaceholder("Enter your password...").fill("john");
        await page.getByPlaceholder("Repeat your password...").fill("john");
        await page.getByRole("button", { name: "JOIN" }).click();
        await page.getByRole("button", { name: "MINT CREDITS" }).click();
        const value = await page.getByTestId("invoice-amount").textContent();
        exec(
            `dfx --identity local-minter ledger transfer --amount ${value} --memo 0 6b7ebd22b3ad442ffd64168b44068e6093b3a2f3f17230974e89ae60eef2ae8d`,
        );
        await page.getByRole("button", { name: "CHECK BALANCE" }).click();
        await page.getByRole("button", { name: "CREATE USER" }).click();
        await page.getByPlaceholder("alphanumeric").fill("john");
        await page
            .getByPlaceholder("tell us what we should know about you")
            .fill("I am John");
        await page.getByRole("button", { name: "SAVE" }).click();
        await expect(page).toHaveTitle("TAGGR");
    });

    test("Create a post with poll", async () => {
        // Create a post
        await page.getByRole("button", { name: "POST" }).click();
        await page.locator("textarea").fill("Poll from John");
        await page.getByTestId("poll-button").click();
        await page.getByTestId("poll-editor").fill("YES\nNO\nCOMMENTS");
        await page.getByRole("button", { name: "SUBMIT" }).click();
        await page.waitForURL(/#\/post\//);

        // Make sure the post loads
        await expect(
            page.locator("article", { hasText: /Poll from John/ }),
        ).toBeVisible();

        // Make sure the post is visible on the front page too
        await page.goto("/");
        await expect(
            page.locator("article", {
                hasText: /Poll from John/,
            }),
        ).toBeVisible();

        // Vote on poll
        const feedItem = page.locator(".feed_item", { hasText: /Poll/ });
        await feedItem.locator("input[type=radio]").first().click();
        await feedItem
            .getByRole("button", { name: "SUBMIT", exact: true })
            .click();
        await expect(feedItem).toHaveText(/100%/);

        // Revote
        await feedItem.getByRole("link", { name: /CHANGE VOTE/ }).click();
        await feedItem.locator("input[type=radio]").nth(1).click();
        await feedItem
            .getByRole("button", { name: "SUBMIT ANONYMOUSLY" })
            .click();
        await expect(feedItem).toHaveText(/100%/);
        await expect(feedItem).toHaveText(/N\/A/);
    });

    test("Repost the poll", async () => {
        await page.goto("/");
        // Repost the poll
        const feedItem = page.locator(".feed_item", { hasText: /Poll/ });
        await feedItem.getByTestId("post-info-toggle").click();
        await feedItem.locator("button[title=Repost]").click();
        await page.waitForURL(/#\/new/);
        await page.locator("textarea").fill("Repost of the poll");
        await page.getByRole("button", { name: "SUBMIT" }).click();
        await page.waitForURL(/#\/post\//);

        // Make sure the post is visible on the front page too
        await page.goto("/");
        await expect(
            page.locator("article", {
                hasText: /Repost of the poll/,
            }),
        ).toBeVisible();

        const repostFeedItem = page.locator(".feed_item", {
            hasText: /Repost of the poll/,
        });
        await expect(repostFeedItem.getByText(/Poll from John/)).toBeVisible();
    });
});
