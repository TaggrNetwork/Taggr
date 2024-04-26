import { test, expect, Page } from "@playwright/test";
import { resolve } from "node:path";
import { exec } from "./command";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

test.describe.configure({ mode: "serial" });

test.describe("Upgrades & token transfer flow", () => {
    let page: Page;
    let inviteLink: string;

    test.beforeAll(async ({ browser }) => {
        page = await browser.newPage();
    });

    test("Registration", async () => {
        await page.goto("/");
        // Registration flow
        await page.getByRole("button", { name: "CONNECT" }).click();
        await page.getByRole("button", { name: "PASSWORD" }).click();
        await page.getByPlaceholder("Enter your password...").fill("eve");
        await page.getByRole("button", { name: "JOIN" }).click();
        await page.waitForTimeout(1000);
        await page.getByPlaceholder("Enter your password...").fill("eve");
        await page.getByRole("button", { name: "JOIN" }).click();
        const stalwartPrincipal =
            "qjuij-xy6vt-yssaf-dar36-pqa7n-5plk4-3dfy3-ppec7-exsio-qy6xh-7qe";
        await expect(page.getByText(stalwartPrincipal)).toBeVisible();
        exec(
            "dfx --identity local-minter ledger transfer --amount 1 --memo 0 2e670a6cf5ec1a1387dc8e02da3279f8e9221c2191b6f7532f449bb439538f20",
        );
        await page.getByRole("button", { name: "MINT CREDITS" }).click();
        await page.getByRole("button", { name: "CREATE USER" }).click();
        await page.getByPlaceholder("alphanumeric").fill("eve");
        await page.getByRole("button", { name: "SAVE" }).click();
        exec("dfx canister call taggr make_stalwart '(\"eve\")'");
    });

    test("Create a post and an invite", async () => {
        await page.goto("/");
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
        await page.getByRole("button", { name: "PASSWORD" }).click();
        await page.getByPlaceholder("Enter your password...").fill("pete");
        await page.getByPlaceholder("Repeat your password...").fill("pete");
        await page.getByRole("button", { name: "JOIN" }).click();
        await page.getByPlaceholder("alphanumeric").fill("pete");
        await page.getByRole("button", { name: "SAVE" }).click();

        await page
            .locator(".feed_item", { hasText: "Message from Eve" })
            .getByTestId("reaction-picker")
            .click();
        // React with a star
        await page
            .locator('button[title="Reward points: 10"]')
            .first()
            .click({ delay: 3000 });
        await page.waitForTimeout(4500);
    });

    test("Trigger minting", async () => {
        exec("dfx canister call taggr weekly_chores");
        await page.waitForTimeout(1000);
        await page.reload();
    });

    test("Wallet", async () => {
        // Test the wallet functionality
        await page.goto("/");
        await page.getByTestId("toggle-user-section").click();

        await expect(page.getByTestId("token-balance")).toHaveText("10");

        const transferExecuted = new Promise((resolve, _reject) => {
            page.on("dialog", async (dialog) => {
                if (
                    dialog.message().includes("Enter the recipient principal")
                ) {
                    await dialog.accept("6qfxa-ryaaa-aaaai-qbhsq-cai");
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

        await expect(page.getByTestId("token-balance")).toHaveText("4.75");
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
        await page.getByRole("button", { name: "PASSWORD" }).click();
        await page.getByPlaceholder("Enter your password...").fill("eve");
        await page.getByRole("button", { name: "JOIN" }).click();

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

        await new Promise((resolve, _reject) => {
            page.on("dialog", async (dialog) => {
                if (
                    dialog
                        .message()
                        .includes(
                            "Do you really want to upload a new binary",
                        ) ||
                    dialog.message().includes("Your vote was submitted")
                ) {
                    await dialog.accept();
                }
                if (dialog.message().includes("Done")) {
                    await dialog.accept();
                    resolve(null);
                }
            });
            fileChooser.setFiles([binaryPath]);
        });

        page.reload();
        await expect(page.getByText("Binary set: true")).toBeVisible();

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
        await page.getByRole("button", { name: "TECHNICAL" }).click();
        await expect(
            page.getByText("Executing the canister upgrade"),
        ).toBeVisible();
        await expect(page.getByText("Upgrade succeeded")).toBeVisible();
    });

    test("Regular proposal", async () => {
        await page.goto("/#/proposals");

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
});

async function hashFile(filePath: string): Promise<string> {
    const hash = createHash("sha256");
    const file = await readFile(filePath);
    hash.update(file);

    return hash.digest("hex");
}
