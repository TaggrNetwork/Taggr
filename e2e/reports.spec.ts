import { test, expect, Page } from "@playwright/test";
import { exec } from "./command";

test.describe.configure({ mode: "serial" });

test.describe("Reports", () => {
    let page: Page;
    let inviteLink1: string;
    let inviteLink2: string;

    test.beforeAll(async ({ browser }) => {
        page = await browser.newPage();
    });

    test("Registration", async () => {
        await page.goto("/");
        // Registration flow
        await page.getByRole("button", { name: "CONNECT" }).click();
        await page.getByRole("button", { name: "PASSWORD" }).click();
        await page.getByPlaceholder("Enter your password...").fill("joe");
        await page.getByRole("button", { name: "JOIN" }).click();
        await page.getByPlaceholder("Enter your password...").fill("joe");
        await page.getByRole("button", { name: "JOIN" }).click();
        exec(
            "dfx --identity local-minter ledger transfer --amount 1 --memo 0 96ee0e335b0c22203a5bf20f7a5feb2c400da29527c8687e3d927f7a590cf80e",
        );
        await page.getByRole("button", { name: "MINT CREDITS" }).click();
        await page.getByRole("button", { name: "CREATE USER" }).click();
        await page.getByPlaceholder("alphanumeric").fill("joe");
        await page.getByRole("button", { name: "SAVE" }).click();
        exec("dfx canister call taggr make_stalwart '(\"joe\")'");
    });

    test("Create two invites", async () => {
        await page.goto("/");
        // Create an invite
        await page.goto("/#/invites");
        await page.getByRole("button", { name: "CREATE" }).click();
        await page.getByRole("button", { name: "CREATE" }).click();
        inviteLink1 = await page
            .getByText(/.*#\/welcome.*/)
            .first()
            .textContent();
        inviteLink2 = await page
            .getByText(/.*#\/welcome.*/)
            .nth(1)
            .textContent();
    });

    test("Registration by invite 1 and create a post", async ({ page }) => {
        await page.goto(inviteLink1);
        await page.getByRole("button", { name: "PASSWORD" }).click();
        await page.getByPlaceholder("Enter your password...").fill("jane");
        await page.getByPlaceholder("Repeat your password...").fill("jane");
        await page.getByRole("button", { name: "JOIN" }).click();
        await page.getByPlaceholder("alphanumeric").fill("jane");
        await page.getByRole("button", { name: "SAVE" }).click();

        // Create a new post
        await page.locator("#logo").click();
        await page.getByRole("button", { name: "POST" }).click();
        await page.locator("textarea").fill("Good stuff");
        await page.getByRole("button", { name: "SEND" }).click();
        await page.waitForURL(/#\/post\//);
    });

    test("Registration by invite 2 and create a post", async ({ page }) => {
        await page.goto(inviteLink2);
        await page.getByRole("button", { name: "PASSWORD" }).click();
        await page.getByPlaceholder("Enter your password...").fill("kyle");
        await page.getByPlaceholder("Repeat your password...").fill("kyle");
        await page.getByRole("button", { name: "JOIN" }).click();
        await page.getByPlaceholder("alphanumeric").fill("kyle");
        await page.getByRole("button", { name: "SAVE" }).click();

        // Create a new post
        await page.locator("#logo").click();
        await page.getByRole("button", { name: "POST" }).click();
        await page.locator("textarea").fill("Illigal stuff");
        await page.getByRole("button", { name: "SEND" }).click();
        await page.waitForURL(/#\/post\//);
    });

    test("Mint credits and send to user", async () => {
        await page.goto("/#/wallet");
        page.on("dialog", async (dialog) => {
            if (
                dialog
                    .message()
                    .includes("Enter the number of 1000s of credits to mint")
            ) {
                await dialog.accept("1");
            }
        });
        await page.getByRole("button", { name: "MINT" }).click();
        await expect(page.getByTestId("credits-balance")).toHaveText("1,900");

        await page.goto("/#/user/jane");
        await page.getByTestId("profile-burger-menu").click();
        page.on("dialog", async (dialog) => {
            if (dialog.message().includes("Enter the amount")) {
                await dialog.accept("1600");
            }
            if (dialog.message().includes("You are transferring")) {
                await dialog.accept();
            }
        });
        await page.getByRole("button", { name: "SEND CREDITS" }).click();
        await expect(page.locator("div:has-text('CREDITS') > code")).toHaveText(
            /1,6\d\d/,
        );
    });

    test("Reward user and trigger minting", async () => {
        await page.locator("#logo").click();
        await page.getByTestId("tab-NEW").click();
        // Find jane's post and react with a star
        const feedItem = page.locator(".feed_item", {
            hasText: /Good stuff/,
        });
        await feedItem.getByTestId("post-info-toggle").click();
        await feedItem.locator('button[title="Karma points: 10"]').click();
        // Wait because the UI waits for 4s before sending the command
        await page.waitForTimeout(4500);
        exec("dfx canister call taggr weekly_chores");
        await page.waitForTimeout(500);
    });

    test("Login and report user", async ({ page }) => {
        await page.goto("/");
        await page.getByRole("button", { name: "CONNECT" }).click();
        await page.getByRole("button", { name: "PASSWORD" }).click();
        await page.getByPlaceholder("Enter your password...").fill("jane");
        await page.getByRole("button", { name: "JOIN" }).click();

        await page.goto("/#/user/kyle");
        await page.getByTestId("profile-burger-menu").click();
        const reporting = new Promise((resolve, reject) => {
            page.on("dialog", async (dialog) => {
                if (
                    dialog
                        .message()
                        .includes("You are reporting this user to stalwarts")
                ) {
                    await dialog.accept("mfer");
                } else if (dialog.message().includes("Report accepted!")) {
                    await dialog.accept("");
                    resolve(null);
                } else {
                    reject("unexpected error: " + dialog.message());
                }
            });
        });
        await page.getByRole("button", { name: "REPORT" }).click();
        await reporting;
    });

    test("Confirm the report", async () => {
        await page.reload();
        await page.goto("/#/inbox");
        await expect(page.getByText("reported")).toBeVisible();

        await page.goto("/#/user/kyle");
        await page.getByRole("button", { name: "✅ AGREE" }).click();
        await page.waitForTimeout(2000);
        await page.reload();
        await expect(page.locator("div:has-text('REWARDS') > code")).toHaveText(
            "-1,000",
        );
    });
});
