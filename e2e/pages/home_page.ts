import { Locator, Page } from "@playwright/test";
import { InternetIdentityPage } from "./internet_identity_page";

export class HomePage {
  public readonly welcomeAboardHeader: Locator;
  public readonly connectButton: Locator;
  private readonly loginWithInternetIdentityButton: Locator;

  constructor(private readonly page: Page) {
    this.welcomeAboardHeader = page.locator("h1");
    this.connectButton = page.locator("button", {
      hasText: "CONNECT",
    });
    this.loginWithInternetIdentityButton = page.locator("button", {
      hasText: "INTERNET IDENTITY",
    });
  }

  public async goto(): Promise<void> {
    await this.page.goto("/");
  }

  public async openInternetIdentityLoginPage(): Promise<InternetIdentityPage> {
    await this.connectButton.click();

    const [internetIdentityPopup] = await Promise.all([
      this.page.waitForEvent("popup"),
      this.loginWithInternetIdentityButton.click(),
    ]);

    return new InternetIdentityPage(internetIdentityPopup);
  }
}
