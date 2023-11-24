import { AccountIdentifier } from "@dfinity/ledger-icp";
import { Locator, Page } from "@playwright/test";
import { icpToE8s, textToNumber } from "../support";

export class WalletPage {
    private readonly icpAccountElement: Locator;
    private readonly icpAmountElement: Locator;
    private readonly icpTransferButton: Locator;
    private readonly creditsAmountElement: Locator;
    private readonly mintCreditsAmountButton: Locator;
    private readonly loadingSpinner: Locator;

    constructor(private readonly page: Page) {
        this.icpAccountElement = page.locator("a:near(h2:has-text('ICP'))");
        this.icpAmountElement = page.getByTestId("icp-amount");
        this.icpTransferButton = page.locator(
            "button:near(h2:has-text('ICP'))",
            {
                hasText: "TRANSFER",
            },
        );
        this.creditsAmountElement = page.getByTestId("credits-amount");
        this.mintCreditsAmountButton = page.locator("button", {
            hasText: "MINT",
        });
        this.loadingSpinner = page.getByTestId("loading-spinner");
    }

    public async getIcpAccount(): Promise<AccountIdentifier> {
        const icpAccount = await this.icpAccountElement.textContent();

        return AccountIdentifier.fromHex(icpAccount);
    }

    public async getIcpAmount(): Promise<bigint> {
        const icpAmount = await this.icpAmountElement.textContent();

        return icpToE8s(Number(icpAmount));
    }

    public async getCreditsAmount(): Promise<number> {
        const creditsAmount = await this.creditsAmountElement.textContent();

        return textToNumber(creditsAmount);
    }

    public async transferIcp(amount: number, account: string): Promise<void> {
        let dialogCount = 0;
        this.page.on("dialog", (dialog) => {
            if (dialogCount === 0) {
                dialog.accept(amount.toString());
                dialogCount++;
            } else if (dialogCount === 1) {
                dialog.accept(account);
                dialogCount++;
            } else if (dialogCount === 2) {
                dialog.accept();
                dialogCount++;
            }
        });

        await this.icpTransferButton.click();
        await this.loadingSpinner.waitFor({ state: "visible" });
        await this.loadingSpinner.waitFor({ state: "hidden" });
    }

    public async mintCredits(kiloCredits: number): Promise<void> {
        this.page.on("dialog", (dialog) => {
            dialog.accept(kiloCredits.toString());
        });

        await this.mintCreditsAmountButton.click();
        await this.loadingSpinner.waitFor({ state: "visible" });
        await this.loadingSpinner.waitFor({ state: "hidden" });
    }
}
