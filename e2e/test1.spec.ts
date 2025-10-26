import { test, expect, Page, Locator } from "@playwright/test";
import { resolve } from "node:path";
import { exec, mkPwd, transferICP } from "./command";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { canisterId } from "./setup";

test.describe.configure({ mode: "serial" });

const executeTransfer = async (page: Page, btn: Locator, amount = "5") => {
    // Q1 - enter the principal receiver
    await new Promise(async (resolve) => {
        page.once("dialog", async (dialog) => {
            if (dialog.message().includes("Enter the recipient principal")) {
                await dialog.accept("6qfxa-ryaaa-aaaai-qbhsq-cai");
                resolve(null);
            }
        });
        // Click button after listener is setup
        await btn.click();
    });

    // Q2 - enter the amount
    await new Promise((resolve) => {
        page.once("dialog", async (dialog) => {
            if (dialog.message().includes("Enter the amount")) {
                await dialog.accept(amount);
                resolve(null);
            }
        });
    });

    // Q3 - confirm receiver and amount
    await new Promise((resolve) => {
        page.once("dialog", async (dialog) => {
            await dialog.accept();
            await page.waitForLoadState("networkidle");
            await page.waitForTimeout(1000);
            resolve(null);
        });
    });
};

test.describe("Upgrades & token transfer flow", () => {
    let page: Page;
    let inviteLink: string;

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
            .fill(mkPwd("eve"));
        await page
            .getByPlaceholder("Repeat your seed phrase...")
            .fill(mkPwd("eve"));
        await page.getByRole("button", { name: "CONTINUE" }).click();
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
        await page.getByRole("button", { name: "CREATE USER" }).click();
        await page.getByPlaceholder("alphanumeric").fill("eve");
        await page.getByRole("button", { name: "SAVE" }).click();
        exec("dfx canister call taggr make_stalwart '(\"eve\")'");
    });

    test("Create a post and an invite", async () => {
        await page.goto("/");
        await page.waitForLoadState("networkidle");
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
        await page.waitForLoadState("networkidle");
        await page.getByRole("button", { name: "SEED PHRASE" }).click();
        await page
            .getByPlaceholder("Enter your seed phrase...")
            .fill(mkPwd("pete"));
        await page
            .getByPlaceholder("Repeat your seed phrase...")
            .fill(mkPwd("pete"));
        await page.getByRole("button", { name: "CONTINUE" }).click();
        await page.getByPlaceholder("alphanumeric").fill("pete");
        await page.getByRole("button", { name: "SAVE" }).click();

        await page
            .locator(".feed_item", { hasText: "Message from Eve" })
            .getByTestId("reaction-picker")
            .click();
        // React with a star
        await page.locator('button[title="Reward points: 10"]').first().click();
    });

    test("Create an auction bid, trigger minting", async ({}) => {
        await page.goto("/#/tokens");
        await page.waitForLoadState("networkidle");
        await page.getByPlaceholder("ICP per 1 TAGGR").fill("0.01");
        await page.getByPlaceholder("Number of TAGGR tokens").fill("15");
        transferICP(
            "aa2ff83cb95478c005b5d108b050bdbf148e3b404f1a0d82173dd779ad70c355",
            0.15,
        );
        await page.getByRole("button", { name: "BID FOR 15 TAGGR" }).click();
        await page.waitForTimeout(1000);

        exec("dfx canister call taggr weekly_chores");
        await page.waitForTimeout(1500);
    });

    test("Wallet", async () => {
        // Test the wallet functionality
        await page.goto("/");
        await page.waitForLoadState("networkidle");
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
        await page.waitForLoadState("networkidle");
        await page.getByRole("button", { name: "SEED PHRASE" }).click();
        await page
            .getByPlaceholder("Enter your seed phrase...")
            .fill(mkPwd("eve"));
        await page.getByRole("button", { name: "CONTINUE" }).click();

        // Make sure the recovery page is visible
        await expect(
            page.getByRole("heading", { name: "RECOVERY" }),
        ).toBeVisible();
        await expect(page.getByText("Binary set: false")).toBeVisible();

        // Upload the binary
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

        let retries = 10;
        while (retries > 0) {
            await page.waitForTimeout(2000);
            await page.reload();
            await page.waitForLoadState("networkidle");
            const statusText = await page
                .getByTestId("status")
                .textContent({ timeout: 5000 })
                .catch(() => null);
            if (statusText?.includes("Binary set: true")) {
                break;
            }
            retries--;
        }

        await expect(
            page.getByTestId("status").filter({ hasText: "Binary set: true" }),
        ).toBeVisible({ timeout: 15000 });

        // Vote for the release
        const buildHash = await hashFile(binaryPath);
        await page.getByTestId("hash-input").fill(buildHash);
        await page.getByRole("button", { name: "SUBMIT HASH" }).click();
        await expect(page.getByText("votes: 100%")).toBeVisible();
        await expect(
            page.getByRole("heading", { name: "Supporters" }),
        ).toBeVisible();

        exec("dfx canister call taggr chores");
    });

    test("Verify recovery upgrade", async () => {
        await page.waitForTimeout(6000);
        await page.goto("/#/dashboard");
        await page.waitForLoadState("networkidle");
        await page.getByRole("button", { name: "TECHNICAL" }).click();
        await expect(
            page.getByText("Executing the canister upgrade"),
        ).toBeVisible();
        await expect(page.getByText("Upgrade succeeded")).toBeVisible();
    });

    test("Regular proposal", async () => {
        await page.goto("/#/proposals");
        await page.waitForLoadState("networkidle");

        // Create a regular proposal
        await expect(
            page.getByRole("heading", { name: "PROPOSALS" }),
        ).toBeVisible();
        await page.getByTestId("proposals-burger-button").click();
        await page.locator("textarea").fill("A regular upgrade");

        // Upload the binary
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
        // Wait for async proposal validation
        await page.waitForTimeout(2000);
        await page
            .locator("div")
            .filter({ hasText: /^GIT COMMIT$/ })
            .getByRole("textbox")
            .fill("coffeecoffeecoffee");
        await page.getByRole("button", { name: "SUBMIT" }).click();
        await expect(page.getByText(/STATUS.*OPEN/)).toBeVisible();
        await expect(page.getByText("TYPE: RELEASE")).toBeVisible();

        page.on("dialog", async (dialog) => {
            if (dialog.message().includes("Please enter the build hash")) {
                await dialog.accept(buildHash);
            }
        });

        await page.getByRole("button", { name: "ACCEPT" }).click();
        await expect(page.getByText(/STATUS.*EXECUTED/)).toBeVisible();

        exec("dfx canister call taggr chores");
        await page.locator("#logo").click();
    });

    test("Verify regular upgrade", async () => {
        await page.waitForTimeout(10000);
        await page.goto("/#/dashboard");
        await page.waitForURL(/dashboard/);
        await page.waitForLoadState("networkidle");
        await page.waitForTimeout(2000);
        await page.getByRole("button", { name: "TECHNICAL" }).click();

        expect(
            await page.locator("p", { hasText: /Upgrade succeeded/ }).count(),
        ).toEqual(2);
    });

    test.describe("IC TOKENS", () => {
        test("Add - input", async () => {
            // Enable in settings
            await page.goto("/#/settings");
            const icrcWalletEnableSelect = page.getByTestId("ic-wallet-select");
            await expect(icrcWalletEnableSelect).toBeVisible();
            await icrcWalletEnableSelect.selectOption("YES");
            await icrcWalletEnableSelect.selectOption("YES"); // Select twice due to a bug in UI

            await page.getByRole("button", { name: "SAVE" }).click();
            await page.waitForTimeout(1000);
            await page.reload();
            await page.waitForLoadState("networkidle");

            // Test the wallet functionality
            await page.goto("/");
            await page.waitForLoadState("networkidle");
            await page.getByTestId("toggle-user-section").click();

            await expect(page.getByTestId("token-balance")).toHaveText("9.9"); // Starting balance

            const tokenListLocator = page.locator(
                'div[data-testid="ic-tokens-div"]',
            ); // IC tokens list locator
            expect(tokenListLocator).toBeVisible();

            const addTokenDialog = new Promise((resolve, _reject) => {
                page.once("dialog", async (dialog) => {
                    if (dialog.message().includes("ICRC canister id")) {
                        await dialog.accept(canisterId); // Add Taggr token
                        resolve(null);
                    }
                });
            });

            const addTokenBtn = tokenListLocator.locator(
                'button[title="Add token"]',
            );
            await expect(addTokenBtn).toBeEnabled();
            await addTokenBtn.click();

            // Add token and see it in the list
            await addTokenDialog;

            await expect(page.getByTestId(`${canisterId}-balance`)).toHaveText(
                "9.90",
            ); // Token added to the list
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

            await executeTransfer(page, tokenSendBtn, "4.70"); // Send all remaining balance
            await expect(page.getByTestId(`${canisterId}-balance`)).toHaveText(
                "0.00",
            ); // 0 balance

            // Hide zeros
            await expect(tokenHideZeros).toBeVisible();
            await tokenHideZeros.click();

            // Token removed from the list
            await expect(
                page.getByTestId(`${canisterId}-send`),
            ).not.toBeVisible();

            await tokenHideZeros.click(); // Add zeros back to the list
            await expect(page.getByTestId(`${canisterId}-send`)).toBeVisible();
        });

        test("Remove", async () => {
            const tokenRemoveBtn = page.getByTestId(`${canisterId}-remove`);

            await expect(tokenRemoveBtn).toBeVisible();

            const removeTokenDialog = new Promise((resolve, _reject) => {
                page.once("dialog", async (dialog) => {
                    if (dialog.message().includes("Remove TAGGR")) {
                        await dialog.accept(); // Confirm remove token
                        await page.waitForTimeout(1000);
                        resolve(null);
                    }
                });
            });

            await tokenRemoveBtn.click(); // Remove token
            await removeTokenDialog;
            await expect(
                page.getByTestId(`${canisterId}-remove`),
            ).not.toBeVisible(); // Row removed
        });
    });
});

async function hashFile(filePath: string): Promise<string> {
    const hash = createHash("sha256");
    const file = await readFile(filePath);
    hash.update(file);

    return hash.digest("hex");
}
