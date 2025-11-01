import { test, expect, Page } from "@playwright/test";
import { exec, mkPwd, transferICP } from "./command";
import {
    handleDialog,
    waitForBackendOperation,
    pollForCondition,
} from "./helpers";

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
        await page.waitForLoadState("networkidle");
        // Registration flow
        await page.getByRole("button", { name: "SIGN UP" }).click();
        await page.getByRole("button", { name: "SEED PHRASE" }).click();
        await page
            .getByPlaceholder("Enter your seed phrase...")
            .fill(mkPwd("joe"));
        await page
            .getByPlaceholder("Repeat your seed phrase...")
            .fill(mkPwd("joe"));
        await page.getByRole("button", { name: "CONTINUE" }).click();
        transferICP(
            "e93e7f1cfa411dafa8debb4769c6cc1b7972434f1669083fd08d86d11c0c0722",
            1,
        );
        await page
            .getByRole("button", { name: "MINT CREDITS WITH ICP" })
            .click();
        await page.getByRole("button", { name: "CREATE USER" }).click();
        await page.getByPlaceholder("alphanumeric").fill("joe");
        await page.getByRole("button", { name: "SAVE" }).click();
        await waitForBackendOperation(page);
    });

    test("Create two invites", async () => {
        await page.goto("/");
        await page.waitForLoadState("networkidle");
        await page.goto("/#/invites");
        await page.waitForLoadState("networkidle");
        await page.getByRole("button", { name: "CREATE" }).click();
        await waitForBackendOperation(page);
        await page.getByRole("button", { name: "CREATE" }).click();
        await waitForBackendOperation(page);
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
        await page.waitForLoadState("networkidle");
        await page.getByRole("button", { name: "SEED PHRASE" }).click();
        await page
            .getByPlaceholder("Enter your seed phrase...")
            .fill(mkPwd("jane"));
        await page
            .getByPlaceholder("Repeat your seed phrase...")
            .fill(mkPwd("jane"));
        await page.getByRole("button", { name: "CONTINUE" }).click();
        await page.getByPlaceholder("alphanumeric").fill("jane");
        await page.getByRole("button", { name: "SAVE" }).click();
        await waitForBackendOperation(page);

        await page.locator("#logo").click();
        await page.waitForLoadState("networkidle");
        await page.getByRole("button", { name: "POST" }).click();
        await page.locator("textarea").fill("Good stuff");
        await page.getByRole("button", { name: "SUBMIT" }).click();
        await page.waitForURL(/#\/post\//);
        await waitForBackendOperation(page);
    });

    test("Registration by invite 2 and create a post", async ({ page }) => {
        await page.goto(inviteLink2);
        await page.waitForLoadState("networkidle");
        await page.getByRole("button", { name: "SEED PHRASE" }).click();
        await page
            .getByPlaceholder("Enter your seed phrase...")
            .fill(mkPwd("kyle"));
        await page
            .getByPlaceholder("Repeat your seed phrase...")
            .fill(mkPwd("kyle"));
        await page.getByRole("button", { name: "CONTINUE" }).click();
        await page.getByPlaceholder("alphanumeric").fill("kyle");
        await page.getByRole("button", { name: "SAVE" }).click();
        await waitForBackendOperation(page);

        await page.locator("#logo").click();
        await page.waitForLoadState("networkidle");
        await page.getByRole("button", { name: "POST" }).click();
        await page.locator("textarea").fill("Illigal stuff");
        await page.getByRole("button", { name: "SUBMIT" }).click();
        await page.waitForURL(/#\/post\//);
        await waitForBackendOperation(page);
    });

    test("Mint credits and send to user", async () => {
        await page.goto("/");
        await page.waitForLoadState("networkidle");
        await page.getByTestId("toggle-user-section").click();

        await handleDialog(
            page,
            "Enter the number of 1000s of credits to mint",
            "1",
            async () => {
                await page.getByRole("button", { name: "MINT" }).click();
            },
        );

        await pollForCondition(
            async () => {
                const creditsText = await page
                    .getByTestId("credits-balance")
                    .textContent();
                const creditsBalance = Number(creditsText.replace(",", ""));
                return creditsBalance >= 1900;
            },
            {
                maxAttempts: 20,
                interval: 1000,
                errorMessage: "Credits balance did not update",
            },
        );

        const creditsBalance = Number(
            (await page.getByTestId("credits-balance").textContent()).replace(
                ",",
                "",
            ),
        );
        expect(creditsBalance).toBeGreaterThanOrEqual(1900);

        await page.goto("/#/user/jane");
        await page.waitForLoadState("networkidle");
        await page.getByTestId("profile-burger-menu").click();

        let dialogCount = 0;
        const dialogHandler = async (dialog: any) => {
            if (dialog.message().includes("Enter the amount")) {
                await dialog.accept("1600");
                dialogCount++;
            } else if (dialog.message().includes("You are transferring")) {
                await dialog.accept();
                dialogCount++;
            }
        };

        page.on("dialog", dialogHandler);
        await page.getByRole("button", { name: "SEND CREDITS" }).click();
        await waitForBackendOperation(page, { timeout: 5000 });
        page.removeListener("dialog", dialogHandler);

        await expect(page.locator("div:has-text('CREDITS') > code")).toHaveText(
            /1,6\d\d/,
        );
    });

    test("Switch to minting, create an auction bid, trigger minting", async ({
        page,
    }) => {
        await page.goto("/");
        await page.waitForLoadState("networkidle");
        await page.getByRole("button", { name: "SIGN IN" }).click();
        await page.getByRole("button", { name: "SEED PHRASE" }).click();
        await page
            .getByPlaceholder("Enter your seed phrase...")
            .fill(mkPwd("jane"));
        await page.getByRole("button", { name: "CONTINUE" }).click();
        await page.waitForLoadState("networkidle");

        await page.goto("/#/settings");
        await page.waitForLoadState("networkidle");
        await page.getByTestId("mode-selector").selectOption("Mining");
        await page.getByRole("button", { name: "SAVE" }).click();
        await waitForBackendOperation(page);

        await page.goto("/#/tokens");
        await page.waitForLoadState("networkidle");
        await page.getByPlaceholder("ICP per 1 TAGGR").fill("0.01");
        await page.getByPlaceholder("Number of TAGGR tokens").fill("15");
        transferICP(
            "12f7ce64042b48e49f6c502c002035acfb3e037cb057ec184f88c04d45e8c03b",
            0.15,
        );
        await page.getByRole("button", { name: "BID FOR 15 TAGGR" }).click();
        await waitForBackendOperation(page);

        exec("dfx canister call taggr weekly_chores");
        await waitForBackendOperation(page, { timeout: 10000 });
    });

    test("Report user", async ({ page }) => {
        exec("dfx canister call taggr make_stalwart '(\"joe\")'");
        await page.goto("/");
        await page.waitForLoadState("networkidle");
        await page.getByRole("button", { name: "SIGN IN" }).click();
        await page.getByRole("button", { name: "SEED PHRASE" }).click();
        await page
            .getByPlaceholder("Enter your seed phrase...")
            .fill(mkPwd("jane"));
        await page.getByRole("button", { name: "CONTINUE" }).click();
        await page.waitForLoadState("networkidle");
        await page.goto("/#/user/kyle");
        await page.waitForLoadState("networkidle");
        await page.getByTestId("profile-burger-menu").click();

        await handleDialog(
            page,
            "You are reporting this user to stalwarts",
            "mfer",
            async () => {
                await page.getByRole("button", { name: "REPORT" }).click();
            },
        );
        await waitForBackendOperation(page);
    });

    test("Confirm the report", async () => {
        await pollForCondition(
            async () => {
                await page.goto("/#/inbox");
                await page.waitForLoadState("networkidle");
                return await page
                    .getByText("reported")
                    .isVisible()
                    .catch(() => false);
            },
            {
                maxAttempts: 10,
                interval: 1000,
                errorMessage: "Report notification not found in inbox",
            },
        );

        await expect(page.getByText("reported")).toBeVisible();

        await page.goto("/#/user/kyle");
        await page.waitForLoadState("networkidle");
        await page.getByRole("button", { name: "✅ AGREE" }).click();
        await waitForBackendOperation(page);

        await pollForCondition(
            async () => {
                await page.reload();
                await page.waitForLoadState("networkidle");
                const rewardsText = await page
                    .locator("div:has-text('REWARDS') > code")
                    .textContent()
                    .catch(() => "");
                return rewardsText === "-1,000";
            },
            {
                maxAttempts: 10,
                interval: 1000,
                errorMessage: "Rewards penalty not applied",
            },
        );

        await expect(page.locator("div:has-text('REWARDS') > code")).toHaveText(
            "-1,000",
        );
    });

    test("Token transfer to user", async ({ page }) => {
        await page.goto("/");
        await page.waitForLoadState("networkidle");
        await page.getByRole("button", { name: "SIGN IN" }).click();
        await page.getByRole("button", { name: "SEED PHRASE" }).click();
        await page
            .getByPlaceholder("Enter your seed phrase...")
            .fill(mkPwd("jane"));
        await page.getByRole("button", { name: "CONTINUE" }).click();
        await page.waitForLoadState("networkidle");
        await page.getByTestId("toggle-user-section").click();

        await expect(page.getByTestId("token-balance")).toHaveText("15");

        let dialogCount = 0;
        const dialogHandler = async (dialog: any) => {
            if (dialog.message().includes("Enter the recipient principal")) {
                await dialog.accept(
                    "evuet-jp2tc-7uwe3-dpgmg-xxr4f-duv55-36d7t-i5nxm-vgc33-cddq3-wae",
                );
                dialogCount++;
            } else if (dialog.message().includes("Enter the amount")) {
                await dialog.accept("5");
                dialogCount++;
            } else if (dialog.message().includes("You are transferring")) {
                await dialog.accept();
                dialogCount++;
            }
        };

        page.on("dialog", dialogHandler);
        await page.getByTestId("tokens-transfer-button").click();
        await waitForBackendOperation(page, { timeout: 5000 });
        page.removeListener("dialog", dialogHandler);

        await page.goto("/#/user/joe");
        await page.waitForLoadState("networkidle");
        await expect(
            page.locator("div.db_cell:has-text('TOKENS') > a"),
        ).toHaveText("5");
    });
});
