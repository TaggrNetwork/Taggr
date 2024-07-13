import { test, expect, Page } from "@playwright/test";
import { exec } from "./command";

test.describe.configure({ mode: "serial" });

test.describe("Report and transfer to user", () => {
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
        await page.waitForTimeout(1000);
        await page.getByPlaceholder("Enter your password...").fill("joe");
        await page.getByRole("button", { name: "JOIN" }).click();
        exec(
            "dfx --identity local-minter ledger transfer --amount 1 --memo 0 a8caaf21598f17df5a17ce655b3a39298559b76f23ea1b2afddd312d0abb04e8",
        );
        await page.getByRole("button", { name: "MINT CREDITS" }).click();
        await page.getByRole("button", { name: "CREATE USER" }).click();
        await page.getByPlaceholder("alphanumeric").fill("joe");
        await page.getByRole("button", { name: "SAVE" }).click();
        exec("dfx canister call taggr make_stalwart '(\"joe\")'");
        await page.waitForTimeout(500);
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
        await page.getByRole("button", { name: "SUBMIT" }).click();
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
        await page.getByRole("button", { name: "SUBMIT" }).click();
        await page.waitForURL(/#\/post\//);
    });

    test("Mint credits and send to user", async () => {
        await page.goto("/");
        await page.getByTestId("toggle-user-section").click();
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
        await page.waitForTimeout(10000);
        const creditsBalance = Number(
            (await page.getByTestId("credits-balance").textContent()).replace(
                ",",
                "",
            ),
        );
        expect(creditsBalance).toBeGreaterThanOrEqual(1900);

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

    test("Switch to minting, create an auction bid, trigger minting", async ({
        page,
    }) => {
        await page.goto("/");
        await page.getByRole("button", { name: "CONNECT" }).click();
        await page.getByRole("button", { name: "PASSWORD" }).click();
        await page.getByPlaceholder("Enter your password...").fill("jane");
        await page.getByRole("button", { name: "JOIN" }).click();
        await page.waitForTimeout(1000);

        await page.goto("/#/settings");
        await page.getByTestId("mode-selector").selectOption("Mining");
        await page.getByRole("button", { name: "SAVE" }).click();

        await page.goto("/#/tokens");
        await page.getByPlaceholder("ICP per 1 TAGGR").fill("0.01");
        await page.getByPlaceholder("Number of TAGGR tokens").fill("15");
        exec(
            "dfx --identity local-minter ledger transfer --amount 0.15 --memo 0 756c3ee29e97e7f0a4a9e5c153f88b9f3c12dd43394c4298bbc9f4de3fc84121",
        );
        await page.getByRole("button", { name: "CREATE MY BID" }).click();
        await page.waitForTimeout(1000);

        exec("dfx canister call taggr weekly_chores");
        await page.waitForTimeout(1500);
    });

    test("Report user", async ({ page }) => {
        await page.goto("/");
        await page.getByRole("button", { name: "CONNECT" }).click();
        await page.getByRole("button", { name: "PASSWORD" }).click();
        await page.getByPlaceholder("Enter your password...").fill("jane");
        await page.getByRole("button", { name: "JOIN" }).click();
        await page.waitForTimeout(1000);
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
        await page.waitForTimeout(1000);
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

    test("Token transfer to user", async ({ page }) => {
        await page.goto("/");
        await page.getByRole("button", { name: "CONNECT" }).click();
        await page.getByRole("button", { name: "PASSWORD" }).click();
        await page.getByPlaceholder("Enter your password...").fill("jane");
        await page.getByRole("button", { name: "JOIN" }).click();
        await page.waitForTimeout(1000);
        await page.getByTestId("toggle-user-section").click();

        await expect(page.getByTestId("token-balance")).toHaveText("15");

        const transferExecuted = new Promise((resolve, _reject) => {
            page.on("dialog", async (dialog) => {
                if (
                    dialog.message().includes("Enter the recipient principal")
                ) {
                    // Joe's principal
                    await dialog.accept(
                        "62pp3-suqb6-5endn-psc4d-2ytvb-xatk2-5pp6u-qwhpd-u3ko3-npsin-qae",
                    );
                }
                if (dialog.message().includes("Enter the amount")) {
                    await dialog.accept("5");
                }
                if (dialog.message().includes("You are transferring")) {
                    await dialog.accept();
                    await page.waitForLoadState("networkidle");
                    await page.waitForTimeout(3000);
                    resolve(null);
                }
            });
        });

        await page.getByTestId("tokens-transfer-button").click();

        await transferExecuted;

        await page.goto("/#/user/joe");
        await expect(page.locator("div:has-text('TOKENS') > a")).toHaveText(
            "5",
        );
    });
});
