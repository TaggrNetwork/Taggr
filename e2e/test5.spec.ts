import { waitForUILoading, handleDialog } from "./helpers";
import { test, expect, Page } from "@playwright/test";
import { mkPwd, transferICP } from "./command";

test.describe.configure({ mode: "serial" });

test.describe("Domain config management", () => {
    let page: Page;

    test.beforeAll(async ({ browser }) => {
        page = await browser.newPage();
    });

    test("Setup user with credits", async () => {
        await page.goto("/");
        await waitForUILoading(page);

        await page.getByRole("button", { name: "SIGN UP" }).click();
        await page.getByRole("button", { name: "SEED PHRASE" }).click();
        await page
            .getByPlaceholder("Enter your seed phrase...")
            .fill(mkPwd("domainuser"));
        await page
            .getByPlaceholder("Repeat your seed phrase...")
            .fill(mkPwd("domainuser"));
        const reloadPromise = page.waitForEvent("load", { timeout: 30000 });
        await page.getByRole("button", { name: "CONTINUE" }).click();
        await reloadPromise;
        await waitForUILoading(page);

        await page
            .getByRole("button", { name: "MINT CREDITS WITH ICP" })
            .click();
        const account = (await page
            .getByTestId("account-to-transfer-to")
            .textContent())!.trim();
        transferICP(account, 1);
        await page.getByRole("button", { name: "CHECK BALANCE" }).click();
        await page.getByRole("button", { name: "CREATE USER" }).click();
        await page.getByPlaceholder("alphanumeric").fill("domainuser");
        await page.getByRole("button", { name: "SAVE" }).click();
        await waitForUILoading(page);

        // Mint extra credits for domain operations
        await page.getByTestId("toggle-user-section").click();
        await handleDialog(
            page,
            "Enter the number of 1000s of credits to mint",
            "2",
            async () => {
                await page.getByRole("button", { name: "MINT" }).click();
            },
        );
        await waitForUILoading(page);
    });

    test("Add domain", async () => {
        await page.goto("/#/domains");
        await waitForUILoading(page);
        await expect(
            page.getByRole("heading", { name: "DOMAINS", exact: true }),
        ).toBeVisible();

        // Add a new domain via the page-level burger menu
        await page.getByTestId("domain-burger-menu").click();
        const domainInput = page.getByPlaceholder(
            "Domain name, e.g. hostname.com",
        );
        await domainInput.waitFor({ state: "visible" });
        await domainInput.fill("test.domain");
        await page.getByRole("button", { name: "ADD" }).click();
        await waitForUILoading(page);
        await expect(page.locator(".info_popup_message")).toContainText(
            "Domain added",
        );

        // Verify domain appears in list
        await page.reload();
        await waitForUILoading(page);
        await expect(
            page.getByRole("link", { name: "test.domain", exact: true }),
        ).toBeVisible();
        await expect(
            page.getByRole("heading", { name: "Your domains" }),
        ).toBeVisible();

        // Cannot add duplicate
        await page.getByTestId("domain-burger-menu").click();
        const dupInput = page.getByPlaceholder(
            "Domain name, e.g. hostname.com",
        );
        await dupInput.waitFor({ state: "visible" });
        await dupInput.fill("test.domain");
        await page.getByRole("button", { name: "ADD" }).click();
        await waitForUILoading(page);
        await expect(page.locator(".info_popup_message")).toContainText(
            "domain exists",
            { ignoreCase: true },
        );
    });

    test("Configure and remove domain", async () => {
        const domainForm = () =>
            page.locator(".stands_out", { hasText: "test.domain" });

        // Whitelist
        await page.reload();
        await waitForUILoading(page);
        await expect(domainForm()).toBeVisible();
        await domainForm().locator("select").selectOption("whitelist");
        await domainForm().locator("textarea").fill("TESTREALM");
        await domainForm().getByRole("button", { name: "SUBMIT" }).click();
        await waitForUILoading(page);
        await expect(page.locator(".info_popup_message")).toContainText(
            "Config updated",
        );

        await page.reload();
        await waitForUILoading(page);
        await expect(page.getByText("White-listed realms")).toBeVisible();
        await expect(page.getByText("/TESTREALM")).toBeVisible();

        // Blacklist
        await domainForm().locator("select").selectOption("blacklist");
        await domainForm().locator("textarea").fill("BLOCKEDREALM");
        await domainForm().getByRole("button", { name: "SUBMIT" }).click();
        await waitForUILoading(page);
        await expect(page.locator(".info_popup_message")).toContainText(
            "Config updated",
        );

        await page.reload();
        await waitForUILoading(page);
        await expect(page.getByText("Black-listed realms")).toBeVisible();
        await expect(page.getByText("/BLOCKEDREALM")).toBeVisible();

        // Remove
        await domainForm().getByRole("button", { name: "REMOVE" }).click();
        await waitForUILoading(page);
        await expect(page.locator(".info_popup_message")).toContainText(
            "Domain removed",
        );

        // Verify gone
        await page.reload();
        await waitForUILoading(page);
        await expect(
            page.getByRole("link", { name: "test.domain", exact: true }),
        ).not.toBeVisible();
    });
});
