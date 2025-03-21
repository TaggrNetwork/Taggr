import { test, expect, Page } from "@playwright/test";
import { resolve } from "node:path";
import { exec, mkPwd } from "./command";

test.describe.configure({ mode: "serial" });

test.describe("Regular users flow, part two", () => {
    let page: Page;

    test.beforeAll(async ({ browser }) => {
        page = await browser.newPage();
    });

    test("Registration", async () => {
        await page.goto("/");

        // Registration flow
        await page.getByRole("button", { name: "SIGN UP" }).click();
        await page.getByRole("button", { name: "SEED PHRASE" }).click();
        await page
            .getByPlaceholder("Enter your seed phrase...")
            .fill(mkPwd("john"));
        await page
            .getByPlaceholder("Repeat your seed phrase...")
            .fill(mkPwd("john"));
        await page.getByRole("button", { name: "CONTINUE" }).click();
        await page
            .getByRole("button", { name: "MINT CREDITS WITH ICP" })
            .click();
        const value = await page.getByTestId("invoice-amount").textContent();
        exec(
            `dfx --identity local-minter ledger transfer --amount ${value} --memo 0 c1d0a8187a351972e4f69d00be36ef3e150e0250ecd75c091b57f5b1c70ac563`,
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

    test.describe("Tips", () => {
        test('Logout and login with "eye" user', async () => {
            // Logout and register "eye" user
            await page.getByTestId("toggle-user-section").click();
            await expect(page.locator(`a[title="SIGN OUT"]`)).toBeVisible();
            await page.locator(`a[title="SIGN OUT"]`).click();

            await expect(page).toHaveTitle("TAGGR");

            await page.getByRole("button", { name: "SIGN UP" }).click();
            await page.getByRole("button", { name: "SEED PHRASE" }).click();
            await page
                .getByPlaceholder("Enter your seed phrase...")
                .fill(mkPwd("eye"));
            await page.getByRole("button", { name: "CONTINUE" }).click();
            await page.waitForTimeout(1000);
            await page
                .getByPlaceholder("Enter your seed phrase...")
                .fill(mkPwd("eye"));
            await page
                .getByPlaceholder("Repeat your seed phrase...")
                .fill(mkPwd("eye"));
            await page.getByRole("button", { name: "CONTINUE" }).click();
            await page
                .getByRole("button", { name: "MINT CREDITS WITH ICP" })
                .click();
            const value = await page
                .getByTestId("invoice-amount")
                .textContent();
            exec(
                `dfx --identity local-minter ledger transfer --amount ${value} --memo 0 67e63281c6bccd4645168376e5052043b5f71725bf84f6f6405c4a8e62b37211`,
            );
            await page.getByRole("button", { name: "CHECK BALANCE" }).click();

            await page.getByRole("button", { name: "CREATE USER" }).click();
            await page.getByPlaceholder("alphanumeric").fill("one");
            await page
                .getByPlaceholder("tell us what we should know about you")
                .fill("I am one");
            await page.getByRole("button", { name: "SAVE" }).click();
            await expect(page).toHaveTitle("TAGGR");
        });

        test("Find post and tip it", async () => {
            // Mint 5 Taggr to tipper "eye"
            exec(
                `dfx canister call taggr mint_tokens '("jpyii-f2pki-kh72w-7dnbq-4j7h7-yly5o-k3lik-zgk3g-wnfwo-2w6jd-5ae", 500 : nat64)'`,
            );
            await page.goto("/");
            await page.getByTestId("toggle-user-section").click();
            await expect(page.getByTestId("token-balance")).toHaveText("5");
            await page.getByTestId("toggle-user-section").click();

            // Find post with Poll from John
            const post = page
                .getByTestId("post-body")
                .filter({
                    hasText: "Poll from John",
                })
                .last();
            await expect(post).toBeVisible();
            // Click post menu
            const menuBTN = post.locator(`button[title="Menu"]`);
            await expect(menuBTN).toBeVisible();
            await menuBTN.click();
            // Click tip button
            const postMenu = post.getByTestId("post-menu");
            await expect(postMenu).toBeVisible();
            await postMenu.locator(`button[title="Tip"]`).click();
            // Wait for custom popup and send 1 Taggr
            const popup = page.getByTestId("custom-popup");
            await expect(popup).toBeVisible();
            await expect(popup).toHaveText(/Tip @john with.*/);
            await popup.locator("input").fill("1"); // Send 1 Taggr to john

            popup.getByText("SEND").click();
            // Confirm receiver and amount
            await new Promise((resolve) => {
                page.once("dialog", async (dialog) => {
                    await dialog.accept();
                    await page.waitForLoadState("networkidle");
                    await page.waitForTimeout(1000);
                    resolve(null);
                });
            });

            // Check balance
            await page.goto("/");
            await page.getByTestId("toggle-user-section").click();
            await expect(page.getByTestId("token-balance")).toHaveText("4");
        });

        test("Find post click tip but cancel it", async () => {
            // Find post with Poll from John
            const post = page
                .getByTestId("post-body")
                .filter({
                    hasText: "Poll from John",
                })
                .last();
            await expect(post).toBeVisible();
            // Click post menu
            const menuBTN = post.locator(`button[title="Menu"]`);
            await expect(menuBTN).toBeVisible();
            await menuBTN.click();
            // Click tip button
            const postMenu = post.getByTestId("post-menu");
            await expect(postMenu).toBeVisible();
            await postMenu.locator(`button[title="Tip"]`).click();
            // Wait for custom popup and send 1 Taggr
            const popup = page.getByTestId("custom-popup");
            await expect(popup).toBeVisible();
            await popup.locator("input").fill("1"); // Send 1 Taggr to john
            popup.getByText("SEND").click();
            // Dismiss
            const promise = new Promise((resolve) => {
                page.once("dialog", async (dialog) => {
                    await dialog.dismiss();
                    resolve(null);
                });
            });
            await promise;

            // Check balance
            await page.goto("/");
            await page.getByTestId("toggle-user-section").click();
            await expect(page.getByTestId("token-balance")).toHaveText("4"); // Canceled
        });
    });
});
