import { Locator, Page } from "@playwright/test";
import { InternetIdentityPage } from "./internet_identity_page";
import { GlobalNavigationElement } from "../elements";
import { SettingsPage } from "./settings_page";
import {
  SeedPhraseUser,
  generateSeedPhrase,
  generateUsername,
} from "../support";

export class AcceptInvitePage {
  private readonly loginWithInternetIdentityButton: Locator;
  private readonly loginWithSeedPhraseButton: Locator;
  private readonly seedPhraseInput: Locator;
  private readonly seedPhraseJoinButton: Locator;

  constructor(private readonly page: Page, private readonly inviteUrl: string) {
    this.loginWithInternetIdentityButton = page.locator("button", {
      hasText: "VIA INTERNET IDENTITY",
    });
    this.loginWithSeedPhraseButton = page.locator("button", {
      hasText: "VIA PASSWORD",
    });
    this.seedPhraseInput = page.getByPlaceholder("Enter your password");
    this.seedPhraseJoinButton = page.locator("button", { hasText: "JOIN" });
  }

  public async goto(): Promise<void> {
    await this.page.goto(this.inviteUrl);
  }

  public async openInternetIdentityLoginPage(): Promise<InternetIdentityPage> {
    const [internetIdentityPopup] = await Promise.all([
      this.page.waitForEvent("popup"),
      this.loginWithInternetIdentityButton.click(),
    ]);

    return new InternetIdentityPage(internetIdentityPopup);
  }

  public async loginWithSeedPhrase(): Promise<SeedPhraseUser> {
    await this.loginWithSeedPhraseButton.click();

    const seedPhrase = generateSeedPhrase();
    await this.seedPhraseInput.fill(seedPhrase);
    await this.seedPhraseJoinButton.click();

    // confirm seed phrase
    // uncomment this when seed phrase confirmation is added for users that sign up with an invite
    // await this.seedPhraseInput.fill(seedPhrase);
    // await this.seedPhraseJoinButton.click();

    const settingsPage = new SettingsPage(this.page);
    const username = generateUsername();
    await settingsPage.setUsername(username);
    await settingsPage.save();

    const globalNavigation = new GlobalNavigationElement(this.page);
    const walletPage = await globalNavigation.goToWalletPage();
    const icpAccount = await walletPage.getIcpAccount();

    return {
      seedPhrase,
      icpAccount,
      username,
    };
  }
}
