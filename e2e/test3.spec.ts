import { waitForUILoading, handleDialog, pollForCondition } from "./helpers";
import { test, expect, Page } from "@playwright/test";
import { exec, mkPwd, transferICP } from "./command";

test.describe.configure({ mode: "serial" });

test.describe("Regular users flow, part two", () => {
    let page: Page;

    test.beforeAll(async ({ browser }) => {
        page = await browser.newPage();
    });

    test("Registration", async () => {
        await page.goto("/");
        await waitForUILoading(page);

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
        transferICP(
            "68498cde2c0dd4f5e21baeb053116db6deb280287230ef3ac62aae1d4d76656f",
            value,
        );
        await page.getByRole("button", { name: "CHECK BALANCE" }).click();
        await page.getByRole("button", { name: "CREATE USER" }).click();
        await page.getByPlaceholder("alphanumeric").fill("john");
        await page
            .getByPlaceholder("tell us what we should know about you")
            .fill("I am John");
        await page.getByRole("button", { name: "SAVE" }).click();
        await waitForUILoading(page);
        await expect(page).toHaveTitle("TAGGR");
    });

    test("Create a post with poll", async () => {
        await page.getByRole("button", { name: "POST" }).click();
        await page.locator("textarea").fill("Poll from John");
        await page.getByTestId("poll-button").click();
        await page.getByTestId("poll-editor").fill("YES\nNO\nCOMMENTS");
        await page.getByRole("button", { name: "SUBMIT" }).click();
        await page.waitForURL(/#\/post\//);
        await waitForUILoading(page);

        await expect(
            page.locator("article", { hasText: /Poll from John/ }),
        ).toBeVisible();

        await page.goto("/");
        await waitForUILoading(page);
        await expect(
            page.locator("article", {
                hasText: /Poll from John/,
            }),
        ).toBeVisible();

        const feedItem = page.locator(".feed_item", { hasText: /Poll/ });
        await feedItem.locator("input[type=radio]").first().click();
        await feedItem
            .getByRole("button", { name: "SUBMIT", exact: true })
            .click();
        await waitForUILoading(page);
        await expect(feedItem).toHaveText(/100%/);

        await feedItem.getByRole("link", { name: /CHANGE VOTE/ }).click();
        await feedItem.locator("input[type=radio]").nth(1).click();
        await feedItem
            .getByRole("button", { name: "SUBMIT ANONYMOUSLY" })
            .click();
        await waitForUILoading(page);
        await expect(feedItem).toHaveText(/100%/);
        await expect(feedItem).toHaveText(/N\/A/);
    });

    test("Repost the poll", async () => {
        await page.goto("/");
        await waitForUILoading(page);
        const feedItem = page.locator(".feed_item", { hasText: /Poll/ });
        await feedItem.getByTestId("post-info-toggle").click();
        const repostButton = feedItem.locator("button[title=Repost]");
        await repostButton.waitFor({ state: "visible" });
        await repostButton.click();
        await page.waitForURL(/#\/new/);
        await page.locator("textarea").fill("Repost of the poll");
        await page.getByRole("button", { name: "SUBMIT" }).click();
        await page.waitForURL(/#\/post\//);
        await waitForUILoading(page);

        await page.goto("/");
        await waitForUILoading(page);
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
            await page.getByTestId("toggle-user-section").click();
            await expect(page.locator(`a[title="SIGN OUT"]`)).toBeVisible();
            await page.locator(`a[title="SIGN OUT"]`).click();
            await waitForUILoading(page);

            await expect(page).toHaveTitle("TAGGR");

            await page.getByRole("button", { name: "SIGN UP" }).click();
            await page.getByRole("button", { name: "SEED PHRASE" }).click();
            await page
                .getByPlaceholder("Enter your seed phrase...")
                .fill(mkPwd("eye"));
            await page.getByRole("button", { name: "CONTINUE" }).click();
            await waitForUILoading(page);
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
            transferICP(
                "7d0c7667560d70acd15508e059e40bf8a5589d739500eb9550d7874446f92a14",
                value,
            );
            await page.getByRole("button", { name: "CHECK BALANCE" }).click();
            await waitForUILoading(page);

            await page.getByRole("button", { name: "CREATE USER" }).click();
            await page.getByPlaceholder("alphanumeric").fill("one");
            await page
                .getByPlaceholder("tell us what we should know about you")
                .fill("I am one");
            await page.getByRole("button", { name: "SAVE" }).click();
            await waitForUILoading(page);
            await expect(page).toHaveTitle("TAGGR");
        });

        test("Find post and tip it", async () => {
            exec(
                `dfx canister call taggr mint_tokens '("jpyii-f2pki-kh72w-7dnbq-4j7h7-yly5o-k3lik-zgk3g-wnfwo-2w6jd-5ae", 500 : nat64)'`,
            );
            await page.goto("/");
            await waitForUILoading(page);
            await page.getByTestId("toggle-user-section").click();
            await expect(page.getByTestId("token-balance")).toHaveText("5");
            await page.getByTestId("toggle-user-section").click();
            await waitForUILoading(page);

            const post = page
                .getByTestId("post-body")
                .filter({
                    hasText: "Poll from John",
                })
                .last();
            await expect(post).toBeVisible();
            const menuBTN = post.getByTestId("post-info-toggle");
            await expect(menuBTN).toBeVisible();
            await menuBTN.click();
            const postMenu = post.getByTestId("post-menu");
            await expect(postMenu).toBeVisible();
            await postMenu.locator(`button[title="Tip"]`).click();
            const popup = page.getByTestId("popup");
            await expect(popup).toBeVisible();
            await expect(popup).toHaveText(/Tip john with.*/);
            await popup.locator("input").fill("1");

            // Click SEND to show confirmation
            await popup.getByText("SEND").click();

            // Wait for confirmation UI to appear and click CONFIRM
            await expect(popup.getByText("CONFIRM")).toBeVisible();
            await popup.getByText("CONFIRM").click();

            await pollForCondition(
                async () => {
                    await page.goto("/");
                    await page.getByTestId("toggle-user-section").click();

                    const elem = page.getByTestId("token-balance");
                    const count = await elem.count();
                    if (count === 0) return false;
                    const text = await elem.textContent();
                    return text === "4";
                },
                {
                    maxAttempts: 20,
                    interval: 500,
                    errorMessage:
                        "Token balance did not update to 4 within timeout",
                },
            );

            await expect(page.getByTestId("token-balance")).toHaveText("4");
        });

        test("Find post click tip but cancel it", async () => {
            const post = page
                .getByTestId("post-body")
                .filter({
                    hasText: "Poll from John",
                })
                .last();
            await expect(post).toBeVisible();
            const menuBTN = post.getByTestId("post-info-toggle");
            await expect(menuBTN).toBeVisible();
            await menuBTN.click();
            const postMenu = post.getByTestId("post-menu");
            await expect(postMenu).toBeVisible();
            await postMenu.locator(`button[title="Tip"]`).click();
            const popup = page.getByTestId("popup");
            await expect(popup).toBeVisible();
            await popup.locator("input").fill("1");

            // Click SEND to show confirmation
            await popup.getByText("SEND").click();

            // Wait for confirmation UI to appear and click CANCEL
            await expect(popup.getByText("CANCEL")).toBeVisible();
            await popup.getByText("CANCEL").click();

            await page.goto("/");
            await waitForUILoading(page);
            await page.getByTestId("toggle-user-section").click();
            await expect(page.getByTestId("token-balance")).toHaveText("4");
        });
    });
});
