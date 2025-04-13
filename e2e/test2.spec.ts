import { test, expect, Page } from "@playwright/test";
import { resolve } from "node:path";
import { exec } from "./command";

test.describe.configure({ mode: "serial" });

test.describe("Regular users flow", () => {
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
        await page.getByPlaceholder("Enter your password...").fill("alice");
        await page.getByRole("button", { name: "JOIN" }).click();
        await page.waitForTimeout(1000);
        await page.getByPlaceholder("Enter your password...").fill("alice");
        await page.getByPlaceholder("Repeat your password...").fill("alice");
        await page.getByRole("button", { name: "JOIN" }).click();
        const alicePrincipal =
            "afqmt-iuwxe-fcmq2-gidf2-tqzx2-beg3a-jq7tp-he6c6-xr67k-rtnl7-aqe";
        await expect(page.getByText(alicePrincipal)).toBeVisible();
        exec(
            "dfx --identity local-minter ledger transfer --amount 1 --memo 0 ce8d1d9b278bf41f444a8e1686559f33029602274363e8f13a43e06461f312ab",
        );
        await page.getByRole("button", { name: "MINT CREDITS" }).click();
        await page.getByRole("button", { name: "CREATE USER" }).click();
        await page.getByPlaceholder("alphanumeric").fill("alice");
        await page
            .getByPlaceholder("tell us what we should know about you")
            .fill("I am a #Taggr fan");
        await page.getByRole("button", { name: "SAVE" }).click();
        await expect(page).toHaveTitle("TAGGR");

        await page.goto("/#/inbox");
        await expect(
            page.getByRole("heading", { name: "INBOX" }),
        ).toBeVisible();
        await expect(
            page.getByText("Use #Taggr as your personal blog"),
        ).toBeVisible();

        // Logout
        await page.getByTestId("toggle-user-section").click();
        await page.getByRole("link", { name: /.*SIGN OUT.*/ }).click();
    });

    test("Login and post", async () => {
        // Login flow
        await page.getByRole("button", { name: "CONNECT" }).click();
        await page.getByRole("button", { name: "PASSWORD" }).click();
        await page.getByPlaceholder("Enter your password...").fill("alice");
        await page.getByRole("button", { name: "JOIN" }).click();
        await page.getByTestId("toggle-user-section").click();
        const profileButton = page.getByRole("link", { name: /.*alice.*/ });
        await expect(profileButton).toBeVisible();

        // Open our own profile and make sure it works
        await profileButton.click();
        await expect(
            page.getByRole("heading", { name: "Alice" }),
        ).toBeVisible();
        await expect(
            page.locator("p", { hasText: /I am a #Taggr fan/ }),
        ).toBeVisible();

        // Create a post
        await page.getByRole("button", { name: "POST" }).click();
        await page.locator("textarea").fill("Hello world!");
        const imagePath = resolve(
            __dirname,
            "..",
            "src",
            "frontend",
            "assets",
            "apple-touch-icon.png",
        );
        const [fileChooser] = await Promise.all([
            page.waitForEvent("filechooser"),
            page.getByTestId("file-picker").click(),
        ]);
        await fileChooser.setFiles([imagePath]);
        await page.getByRole("button", { name: "SUBMIT" }).click();
        await page.waitForURL(/#\/post\//);

        // Make sure the post loads
        await expect(
            page.locator("article", { hasText: /Hello world/ }),
        ).toBeVisible();
        await expect(
            page.getByRole("img", { name: "512x512, 2kb" }),
        ).toBeVisible();

        // Edit the post
        await page.getByTestId("post-info-toggle").click();
        await page.locator("button[title=Edit]").click();
        await page.waitForTimeout(1000);
        const value = await page.locator("textarea").inputValue();
        await page
            .locator("textarea")
            .fill(value + "\n\n**Edit:** this is a post-scriptum");
        await page.getByRole("button", { name: "SUBMIT" }).click();
        await page.waitForURL(/#\/post\//);
        await expect(page.getByText("post-scriptum")).toBeVisible();

        // Make sure the post is visible on the front page too
        await page.goto("/");
        await expect(
            page.locator("article", {
                hasText: "Hello world!\n" + "Edit: this is a post-scriptum",
            }),
        ).toBeVisible();
        await expect(
            page.getByRole("img", { name: "512x512, 2kb" }),
        ).toBeVisible();
    });

    test("Wallet", async () => {
        // Test the wallet functionality
        await page.getByTestId("toggle-user-section").click();

        // Let's mint cycles
        await expect(page.getByTestId("credits-balance")).toHaveText("976");
        page.on("dialog", async (dialog) => {
            if (
                dialog
                    .message()
                    .includes("Enter the number of 1000s of credits to mint")
            ) {
                await dialog.accept("2");
            }
        });
        await page.getByRole("button", { name: "MINT" }).click();
        await expect(page.getByTestId("credits-balance")).toHaveText("2,976");

        // Let's transfer some ICP
        const icpBalance = parseFloat(
            await page.getByTestId("icp-balance").textContent(),
        );

        const transferExecuted = new Promise((resolve, _reject) => {
            page.on("dialog", async (dialog) => {
                if (
                    dialog
                        .message()
                        .includes(
                            "Enter the recipient principal or ICP account address",
                        )
                ) {
                    await dialog.accept("6qfxa-ryaaa-aaaai-qbhsq-cai");
                }
                if (
                    dialog
                        .message()
                        .includes("Enter the amount (fee: 0.00010000 ICP)")
                ) {
                    const transferAmount = (icpBalance / 2).toString();
                    await dialog.accept(transferAmount);
                }
                if (dialog.message().includes("You are transferring")) {
                    await dialog.accept();
                    await page.waitForLoadState("networkidle");
                    await page.waitForTimeout(3000);
                    resolve(null);
                }
            });
        });

        await page.getByTestId("icp-transfer-button").click();

        await transferExecuted;

        const newBalance = parseFloat(
            await page.getByTestId("icp-balance").textContent(),
        );
        expect(newBalance).toBeLessThan(icpBalance);
    });

    test("Realms", async () => {
        // Now we can create a new realm
        await page.goto("/#/realms");
        await page.getByRole("button", { name: "CREATE" }).click();
        await page.getByPlaceholder("alphanumeric").fill("WONDERLAND");
        await page.getByTestId("realm-textarea").fill("Alice in wonderland");
        await page.getByRole("button", { name: "CREATE" }).click();

        // Make sure we're in the realm
        await page.getByTestId("realm-burger-button").click();
        await expect(page.getByRole("button", { name: "LEAVE" })).toBeVisible();

        // Now we can create a new post in the new realm
        await page.getByRole("button", { name: "POST" }).click();
        await page.locator("#form_undefined_3").fill("Hello from Alice!");
        await page.getByRole("button", { name: "SUBMIT" }).click();

        // Make sure the post is visible on the front page and is labeled with realm tag
        await page.locator("#logo").click();
        await expect(
            page.locator("article", { hasText: "Hello from Alice!" }),
        ).toBeVisible();
        await expect(
            page.locator('[class="realm_span realm_tag"]').first(),
        ).toHaveText("WONDERLAND");
    });

    test("Invites", async () => {
        // Now we can create a new realm
        await page.goto("/#/invites");
        await page.getByRole("button", { name: "CREATE" }).click();
        inviteLink = await page.getByText(/.*#\/welcome.*/).textContent();
        await page.getByTestId("toggle-user-section").click();
        await page.getByRole("link", { name: /.*SIGN OUT.*/ }).click();
    });

    test("Registration by invite", async () => {
        await page.goto(inviteLink);
        await page.getByRole("button", { name: "PASSWORD" }).click();
        await page.getByPlaceholder("Enter your password...").fill("bob");
        await page.getByPlaceholder("Repeat your password...").fill("bob");
        await page.getByRole("button", { name: "JOIN" }).click();
        await page.getByPlaceholder("alphanumeric").fill("bob");
        await page
            .getByPlaceholder("tell us what we should know about you")
            .fill("Alice invited me");
        await page.getByRole("button", { name: "SAVE" }).click();
        await page.waitForURL(/\//);
    });

    test("Interacting with posts", async () => {
        await page
            .locator(".feed_item", { hasText: /Hello world/ })
            .getByTestId("reaction-picker")
            .click();
        // React with a star
        await page
            .locator(".feed_item", { hasText: /Hello world/ })
            .locator('button[title="Reward points: 10"]')
            .first()
            .click({ delay: 3000 });
        // comment on the first post
        await page
            .locator(".feed_item", { hasText: /Hello world/ })
            .getByTestId("post-info-toggle")
            .click();
        await page.getByPlaceholder("Reply here...").focus();
        await page.locator("textarea").fill("Bob was here");
        await page.getByRole("button", { name: "SUBMIT" }).click();

        // Wait because the UI waits for 4s before sending the command
        await page.waitForTimeout(4000);

        // Check data on the post page
        await page.locator("p", { hasText: /Hello world/ }).click();
        await page.waitForURL(/#\/post\//);
        await expect(
            page.getByTestId("post-comments-toggle").first(),
        ).toHaveText("1");
        await expect(
            page
                .locator(".post_box", { hasText: /Hello world/ })
                .getByTestId("100-reaction")
                .first(),
        ).toHaveText("⭐️1");
        await page.locator("#logo").click();
        await page.waitForTimeout(2000);
    });

    test("User profile", async () => {
        // Check data on alice's profile
        await page.getByRole("link", { name: "alice" }).first().click();

        await page.locator("div:has-text('ACCOUNTING') > code").click();
        await expect(page.locator(".popup_body")).toHaveText(
            /\+1 rewards.*response to post/,
        );
        await page.getByTestId("popup-close-button").click();

        await expect(page.locator("div:has-text('POSTS') > code")).toHaveText(
            "2",
        );
        await page.getByRole("heading", { name: "Interests" }).click();
        await expect(
            page
                .locator(
                    '[class="realm_span clickable padded_rounded right_half_spaced top_half_spaced"]',
                )
                .first(),
        ).toHaveText("WONDERLAND");
    });
});
