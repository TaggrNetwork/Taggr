import { waitForUILoading, invoiceAccount } from "./helpers";
import { test, expect, Page } from "@playwright/test";
import { mkPwd, transferICP } from "./command";

test.describe.configure({ mode: "serial" });

test.describe("Principal change", () => {
    let page: Page;
    let newPrincipal: string;

    test.beforeAll(async ({ browser }) => {
        page = await browser.newPage();
    });

    test("Capture the new identity's principal", async () => {
        await page.goto("/");
        await waitForUILoading(page);

        // Sign up with a fresh identity, read its principal from the "New user
        // detected" page, then leave without creating a user for it.
        await page.getByRole("button", { name: "SIGN UP" }).click();
        await page.getByRole("button", { name: "SEED PHRASE" }).click();
        await page
            .getByPlaceholder("Enter your seed phrase...")
            .fill(mkPwd("newkey"));
        await page
            .getByPlaceholder("Repeat your seed phrase...")
            .fill(mkPwd("newkey"));
        const reload = page.waitForEvent("load", { timeout: 30000 });
        await page.getByRole("button", { name: "CONTINUE" }).click();
        await reload;
        await waitForUILoading(page);

        await expect(page.getByText("New user detected")).toBeVisible();
        newPrincipal = await page.evaluate(
            () => (window as any).principalId as string,
        );
        expect(newPrincipal.length).toBeGreaterThan(0);

        // Sign-out reloads the app; wait for the reload so it can't interrupt
        // the next test's navigation.
        const signOutReload = page.waitForEvent("load", { timeout: 30000 });
        await page.getByRole("button", { name: "SIGN OUT" }).click();
        await signOutReload;
        await waitForUILoading(page);
    });

    test("Register the account to be migrated", async () => {
        await page.goto("/");
        await waitForUILoading(page);

        await page.getByRole("button", { name: "SIGN UP" }).click();
        await page.getByRole("button", { name: "SEED PHRASE" }).click();
        await page
            .getByPlaceholder("Enter your seed phrase...")
            .fill(mkPwd("migrator"));
        await page
            .getByPlaceholder("Repeat your seed phrase...")
            .fill(mkPwd("migrator"));
        const reload = page.waitForEvent("load", { timeout: 30000 });
        await page.getByRole("button", { name: "CONTINUE" }).click();
        await reload;
        await waitForUILoading(page);

        // Pay exactly the invoice, so no ICP is left on the account: the
        // principal change refuses to run while the account holds ICP.
        await page
            .getByRole("button", { name: "MINT CREDITS WITH ICP" })
            .click();
        const amount = (
            (await page.getByTestId("invoice-amount").textContent()) ?? ""
        ).replace(/\s/g, "");
        transferICP(await invoiceAccount(page), amount);
        await page.getByRole("button", { name: "CHECK BALANCE" }).click();
        await waitForUILoading(page);
        await page.getByRole("button", { name: "CREATE USER" }).click();
        await page.getByPlaceholder("alphanumeric").fill("migrator");
        await page.getByRole("button", { name: "SAVE" }).click();
        // Registration redirects to the root via a same-document hash change;
        // wait for it so it can't interrupt the next test's `goto`.
        await page.waitForFunction(
            () => window.location.hash === "",
            undefined,
            {
                timeout: 30000,
            },
        );
        await waitForUILoading(page);
    });

    test("Request the principal change", async () => {
        await page.goto("/#/settings/ADVANCED");
        await waitForUILoading(page);
        await expect(
            page.getByRole("heading", { name: "Principal Change" }),
        ).toBeVisible();

        await page.getByPlaceholder("Your principal").fill(newPrincipal);
        await page.getByRole("button", { name: "CHANGE PRINCIPAL" }).click();

        // The form swaps to an explicit "request registered" state instead of
        // silently logging the user out.
        await expect(page.getByText("Request registered.")).toBeVisible({
            timeout: 30000,
        });
        await expect(page.getByText(newPrincipal)).toBeVisible();

        // Signs out and reloads into the sign-in page; wait for the reload so
        // it can't race the next test.
        const signOutReload = page.waitForEvent("load", { timeout: 30000 });
        await page
            .getByRole("button", {
                name: "SIGN OUT AND SIGN IN WITH NEW PRINCIPAL",
            })
            .click();
        await signOutReload;
        await waitForUILoading(page);
    });

    test("Login with the new principal confirms the change", async () => {
        // We were routed to the sign-in page by the success button.
        await page.getByRole("button", { name: "SEED PHRASE" }).click();
        await page
            .getByPlaceholder("Enter your seed phrase...")
            .fill(mkPwd("newkey"));
        await page.getByRole("button", { name: "CONTINUE" }).click();
        await waitForUILoading(page);

        // Before the fix, signing in with the new principal reported
        // "User not found" and signed the user out instead of confirming the
        // pending change. The account (with its name) must now be reachable.
        await page.getByTestId("toggle-user-section").click();
        await expect(
            page.getByRole("link", { name: /.*MIGRATOR.*/ }),
        ).toBeVisible();
    });
});
