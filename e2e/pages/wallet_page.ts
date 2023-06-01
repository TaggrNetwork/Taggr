import { AccountIdentifier } from "@dfinity/nns";
import { Locator, Page } from "@playwright/test";

export class WalletPage {
  private readonly icpAccountElement: Locator;

  constructor(page: Page) {
    this.icpAccountElement = page.locator("a:near(h2:has-text('ICP'))");
  }

  public async getIcpAccount(): Promise<AccountIdentifier> {
    const icpAccount = await this.icpAccountElement.textContent();

    return AccountIdentifier.fromHex(icpAccount);
  }
}
