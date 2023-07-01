import { Page } from "@playwright/test";
import { CommonUser } from "./create_user";
import { createLedgerClient } from "./ledger";
import { GlobalNavigationElement } from "../elements";
import { icpToE8s } from "./conversion";

export async function topUpCycles(
    page: Page,
    user: CommonUser,
    kiloCycles = 1
): Promise<void> {
    const ledger = await createLedgerClient();

    const globalNavigation = new GlobalNavigationElement(page, user);
    await globalNavigation.goToHomePage();
    const walletPage = await globalNavigation.goToWalletPage();

    const amount = icpToE8s(10);
    const to = await walletPage.getIcpAccount();
    await ledger.transfer({ amount, to });

    await walletPage.mintCycles(kiloCycles);
}
