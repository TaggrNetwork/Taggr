import { AccountIdentifier } from "@dfinity/ledger-icp";
import { Locator, Page } from "@playwright/test";
import { icpToE8s } from "../support";

export class MintInitialCreditsPage {
    public readonly createUserButton: Locator;

    private readonly mintCreditsButton: Locator;
    private readonly icpAmountElement: Locator;
    private readonly icpAccountElement: Locator;
    private readonly checkPaymentButton: Locator;

    constructor(page: Page) {
        this.mintCreditsButton = page.locator("button", {
            hasText: "MINT CREDITS",
        });
        this.icpAmountElement = page.getByTestId("amount-to-transfer");
        this.icpAccountElement = page.getByTestId("account-to-transfer-to");
        this.checkPaymentButton = page.locator("button", {
            hasText: "CHECK BALANCE",
        });
        this.createUserButton = page.locator("button", {
            hasText: "CREATE USER",
        });
    }

    public async mintCredits(): Promise<void> {
        await this.mintCreditsButton.click();
    }

    public async getIcpAmount(): Promise<bigint> {
        const icpAmount = await this.icpAmountElement.textContent();

        return icpToE8s(Number(icpAmount));
    }

    public async getIcpAccount(): Promise<AccountIdentifier> {
        const icpAccount = await this.icpAccountElement.textContent();

        return AccountIdentifier.fromHex(icpAccount);
    }

    public async checkPayment(): Promise<void> {
        await this.checkPaymentButton.click();
    }

    public async createUser(): Promise<void> {
        await this.createUserButton.click();
    }
}
