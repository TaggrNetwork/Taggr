import { waitForUILoading, waitForPageReload } from "./helpers";
import { test, expect, Page, Locator } from "@playwright/test";
import { resolve } from "node:path";
import { exec, mkPwd, transferICP } from "./command";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { canisterId } from "./setup";
import {
    handleDialog,
    handleDialogSequence,
    pollForCondition,
    createAuctionBid,
} from "./helpers";

test.describe.configure({ mode: "serial" });

const executeTransfer = async (page: Page, btn: Locator, amount = "5") => {
    await handleDialogSequence(
        page,
        [
            {
                expectedPattern: "Enter the recipient principal",
                response: "6qfxa-ryaaa-aaaai-qbhsq-cai",
            },
            {
                expectedPattern: "Enter the amount",
                response: amount,
            },
            {
                expectedPattern: /./,
                response: "",
            },
        ],
        async () => {
            await btn.click();
        },
    );

    await waitForUILoading(page);
};

test.describe("Upgrades & token transfer flow", () => {
    let page: Page;
    let inviteLink: string;

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
            .fill(mkPwd("eve"));
        await page
            .getByPlaceholder("Repeat your seed phrase...")
            .fill(mkPwd("eve"));
        const reloadPromise = page.waitForEvent("load", { timeout: 30000 });
        await page.getByRole("button", { name: "CONTINUE" }).click();
        await reloadPromise;
        await waitForUILoading(page);
        const stalwartPrincipal =
            "v5znh-suak4-idmlq-uaq6k-iiygt-7d7de-jq7pf-dpzmt-zhmle-akfo2-mqe";
        await expect(page.getByText(stalwartPrincipal)).toBeVisible();
        transferICP(
            "aa2ff83cb95478c005b5d108b050bdbf148e3b404f1a0d82173dd779ad70c355",
            1,
        );
        await page
            .getByRole("button", { name: "MINT CREDITS WITH ICP" })
            .click();
        await waitForUILoading(page);
        await page.getByRole("button", { name: "CREATE USER" }).click();
        await page.getByPlaceholder("alphanumeric").fill("eve");
        await page.getByRole("button", { name: "SAVE" }).click();
        await waitForUILoading(page);
        exec("dfx canister call taggr make_stalwart '(\"eve\")'");
    });

    test("Create a post and an invite", async () => {
        await page.goto("/");
        await waitForUILoading(page);
        // Create a post
        await page.getByRole("button", { name: "POST" }).click();
        await page.locator("textarea").fill("Message from Eve");
        await page.getByRole("button", { name: "SUBMIT" }).click();
        await page.waitForURL(/#\/post\//);

        // Create an invite
        await page.goto("/#/invites");
        await page.getByRole("button", { name: "CREATE" }).click();
        inviteLink = await page.getByText(/.*#\/welcome.*/).textContent();
    });

    test("Registration by invite and rewarding a post", async ({ page }) => {
        await page.goto(inviteLink);
        await waitForUILoading(page);
        await page.getByRole("button", { name: "SEED PHRASE" }).click();
        await page
            .getByPlaceholder("Enter your seed phrase...")
            .fill(mkPwd("pete"));
        await page
            .getByPlaceholder("Repeat your seed phrase...")
            .fill(mkPwd("pete"));
        const reloadPromise2 = page.waitForEvent("load", { timeout: 30000 });
        await page.getByRole("button", { name: "CONTINUE" }).click();
        await reloadPromise2;
        await waitForUILoading(page);
        await page.getByPlaceholder("alphanumeric").fill("pete");
        await page.getByRole("button", { name: "SAVE" }).click();
        await waitForUILoading(page);

        const feedItem = page.locator(".feed_item", {
            hasText: "Message from Eve",
        });
        await feedItem.waitFor({ state: "visible" });
        await feedItem.getByTestId("reaction-picker").click();
        const rewardButton = page
            .locator('button[title="Reward points: 10"]')
            .first();
        await rewardButton.waitFor({ state: "visible" });
        await rewardButton.click();
        await waitForUILoading(page);
    });

    test("Create an auction bid, trigger minting", async ({}) => {
        await createAuctionBid(
            page,
            "0.01",
            "15",
            transferICP,
            "aa2ff83cb95478c005b5d108b050bdbf148e3b404f1a0d82173dd779ad70c355",
        );

        exec("dfx canister call taggr weekly_chores");
    });

    test("Wallet", async () => {
        await pollForCondition(
            async () => {
                await page.goto("/");
                await waitForUILoading(page);
                await page.getByTestId("toggle-user-section").click();
                const balance = await page
                    .getByTestId("token-balance")
                    .textContent();
                return balance === "15";
            },
            {
                maxAttempts: 15,
                interval: 1000,
                errorMessage:
                    "Token balance did not update to 15 after minting",
            },
        );

        await page.goto("/");
        await waitForUILoading(page);
        await page.getByTestId("toggle-user-section").click();
        await expect(page.getByTestId("token-balance")).toHaveText("15");

        await executeTransfer(page, page.getByTestId("tokens-transfer-button"));

        await expect(page.getByTestId("token-balance")).toHaveText("9.9");
        await page.getByTestId("token-balance").click();
        await page.getByRole("link", { name: "6qfxa" }).click();
        await expect(
            page.getByRole("heading", { name: "TRANSACTIONS OF 6QFXA" }),
        ).toBeVisible();
        await expect(
            page.getByRole("heading", { name: "BALANCE: 5.00 TAGGR" }),
        ).toBeVisible();
    });

    test("Recovery proposal", async ({ page }) => {
        await page.goto("/#/recovery");
        await waitForUILoading(page);
        await page.getByRole("button", { name: "SEED PHRASE" }).click();
        await page
            .getByPlaceholder("Enter your seed phrase...")
            .fill(mkPwd("eve"));
        const reloadPromise3 = page.waitForEvent("load", { timeout: 30000 });
        await page.getByRole("button", { name: "CONTINUE" }).click();
        await reloadPromise3;
        await waitForUILoading(page);

        await expect(
            page.getByRole("heading", { name: "RECOVERY" }),
        ).toBeVisible();
        await expect(page.getByText("Binary set: false")).toBeVisible();

        const binaryPath = resolve(
            __dirname,
            "..",
            "target",
            "wasm32-unknown-unknown",
            "release",
            "taggr.wasm.gz",
        );

        const [fileChooser] = await Promise.all([
            page.waitForEvent("filechooser"),
            page.locator('input[type="file"]').click(),
        ]);

        const dialogPromise1 = page.waitForEvent("dialog");
        await fileChooser.setFiles([binaryPath]);

        const dialog1 = await dialogPromise1;
        expect(
            dialog1
                .message()
                .includes("Do you really want to upload a new binary"),
        ).toBe(true);
        await dialog1.accept();

        const dialog2 = await page.waitForEvent("dialog");
        expect(dialog2.message().includes("Done")).toBe(true);
        await dialog2.accept();

        await pollForCondition(
            async () => {
                await page.reload();
                await waitForUILoading(page);
                const statusText = await page
                    .getByTestId("status")
                    .textContent({ timeout: 5000 })
                    .catch(() => null);
                return statusText?.includes("Binary set: true") || false;
            },
            {
                maxAttempts: 15,
                interval: 2000,
                errorMessage: "Binary was not set after polling",
            },
        );

        await expect(
            page.getByTestId("status").filter({ hasText: "Binary set: true" }),
        ).toBeVisible();

        const buildHash = await hashFile(binaryPath);
        await page.getByTestId("hash-input").fill(buildHash);
        await page.getByRole("button", { name: "SUBMIT HASH" }).click();
        await waitForUILoading(page);
        await expect(page.getByText("votes: 100%")).toBeVisible();
        await expect(
            page.getByRole("heading", { name: "Supporters" }),
        ).toBeVisible();

        exec("dfx canister call taggr chores");
        await waitForUILoading(page, { timeout: 10000 });
        await page.waitForTimeout(4000);
    });

    test("Verify recovery upgrade", async () => {
        await page.goto("/#/dashboard");
        await waitForUILoading(page);

        await pollForCondition(
            async () => {
                const executingCount = await page
                    .getByText("Executing the canister upgrade")
                    .count();
                const successCount = await page
                    .getByText("Upgrade succeeded")
                    .count();
                return executingCount === 1 && successCount === 1;
            },
            {
                maxAttempts: 20,
                interval: 1000,
                errorMessage: "Recovery upgrade did not succeed within timeout",
            },
        );
    });

    test("Regular proposal", async () => {
        await page.goto("/#/proposals");
        await waitForUILoading(page);

        await expect(
            page.getByRole("heading", { name: "PROPOSALS" }),
        ).toBeVisible();
        await page.getByTestId("proposals-burger-button").click();
        await page.locator("textarea").fill("A regular upgrade");

        const binaryPath = resolve(
            __dirname,
            "..",
            "target",
            "wasm32-unknown-unknown",
            "release",
            "taggr.wasm.gz",
        );

        const [fileChooser] = await Promise.all([
            page.waitForEvent("filechooser"),
            page.getByTestId("bin-file-picker").click(),
        ]);

        const buildHash = await hashFile(binaryPath);
        await fileChooser.setFiles([binaryPath]);

        await pollForCondition(
            async () => {
                const commitField = await page
                    .locator("div")
                    .filter({ hasText: /^GIT COMMIT$/ })
                    .getByRole("textbox")
                    .isVisible()
                    .catch(() => false);
                return commitField;
            },
            {
                maxAttempts: 10,
                interval: 500,
                errorMessage: "Proposal validation did not complete",
            },
        );

        await page
            .locator("div")
            .filter({ hasText: /^GIT COMMIT$/ })
            .getByRole("textbox")
            .fill("coffeecoffeecoffee");

        await page.waitForTimeout(1000);

        await page.getByRole("button", { name: "SUBMIT" }).click();
        await waitForUILoading(page);
        await expect(page.getByText(/STATUS.*OPEN/)).toBeVisible();
        await expect(page.getByText("TYPE: RELEASE")).toBeVisible();

        await handleDialog(
            page,
            "Please enter the build hash",
            buildHash,
            async () => {
                await page.getByRole("button", { name: "ACCEPT" }).click();
            },
        );
        await waitForUILoading(page);

        await expect(page.getByText(/STATUS.*EXECUTED/)).toBeVisible();

        exec("dfx canister call taggr chores");
        await waitForUILoading(page, { timeout: 5000 });
        await page.locator("#logo").click();
        await waitForUILoading(page);
    });

    test("Verify regular upgrade", async () => {
        await pollForCondition(
            async () => {
                await page.goto("/#/dashboard");
                await page.reload();
                await page.waitForURL(/dashboard/);
                await waitForUILoading(page);
                const count = await page
                    .locator("p", { hasText: /Upgrade succeeded/ })
                    .count();
                return count === 2;
            },
            {
                maxAttempts: 15,
                interval: 500,
                errorMessage: "Did not find 2 upgrade succeeded messages",
            },
        );

        expect(
            await page.locator("p", { hasText: /Upgrade succeeded/ }).count(),
        ).toEqual(2);
    });

    test.describe("IC TOKENS", () => {
        test("Add - input", async () => {
            await page.goto("/#/settings");
            await waitForUILoading(page);
            const icrcWalletEnableSelect = page.getByTestId("ic-wallet-select");
            await expect(icrcWalletEnableSelect).toBeVisible();
            await icrcWalletEnableSelect.selectOption("YES");
            await icrcWalletEnableSelect.selectOption("YES");

            await page.getByRole("button", { name: "SAVE" }).click();
            await waitForUILoading(page);
            await page.reload();
            await waitForUILoading(page);

            await page.goto("/");
            await waitForUILoading(page);
            await page.getByTestId("toggle-user-section").click();

            await expect(page.getByTestId("token-balance")).toHaveText("9.9");

            const tokenListLocator = page.locator(
                'div[data-testid="ic-tokens-div"]',
            );
            await expect(tokenListLocator).toBeVisible();

            const addTokenBtn = tokenListLocator.locator(
                'button[title="Add token"]',
            );
            await expect(addTokenBtn).toBeEnabled();

            await handleDialog(
                page,
                "ICRC canister id",
                canisterId,
                async () => {
                    await addTokenBtn.click();
                },
            );
            await waitForUILoading(page);

            await expect(page.getByTestId(`${canisterId}-balance`)).toHaveText(
                "9.90",
            );
        });

        test("Send", async () => {
            const tokenSendBtn = page.getByTestId(`${canisterId}-send`);

            await expect(tokenSendBtn).toBeVisible();

            await executeTransfer(page, tokenSendBtn); // Token send button

            await expect(page.getByTestId(`${canisterId}-balance`)).toHaveText(
                "4.80",
            ); // Starting balance
        });

        test("Hide zeros", async () => {
            const tokenHideZeros = page.getByTestId(
                "canisters-hide-zero-balance",
            );
            const tokenSendBtn = page.getByTestId(`${canisterId}-send`);

            await executeTransfer(page, tokenSendBtn, "4.70");
            await expect(page.getByTestId(`${canisterId}-balance`)).toHaveText(
                "0.00",
            );

            await expect(tokenHideZeros).toBeVisible();
            await tokenHideZeros.click();
            await waitForUILoading(page, { timeout: 2000 });

            await expect(
                page.getByTestId(`${canisterId}-send`),
            ).not.toBeVisible();

            await tokenHideZeros.click();
            await waitForUILoading(page, { timeout: 2000 });
            await expect(page.getByTestId(`${canisterId}-send`)).toBeVisible();
        });

        test("Remove", async () => {
            const tokenRemoveBtn = page.getByTestId(`${canisterId}-remove`);
            await expect(tokenRemoveBtn).toBeVisible();

            await handleDialog(page, "Remove TAGGR", "", async () => {
                await tokenRemoveBtn.click();
            });
            await waitForUILoading(page);

            await expect(
                page.getByTestId(`${canisterId}-remove`),
            ).not.toBeVisible();
        });
    });
});

async function hashFile(filePath: string): Promise<string> {
    const hash = createHash("sha256");
    const file = await readFile(filePath);
    hash.update(file);

    return hash.digest("hex");
}
