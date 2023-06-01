import { Locator, Page } from "@playwright/test";

export class RealmPage {
  public readonly leaveRealmButton: Locator;
  public readonly joinRealmButton: Locator;
  private readonly loadingSpinner: Locator;

  constructor(private readonly page: Page, public readonly realmName: string) {
    this.leaveRealmButton = page.locator("button", { hasText: "LEAVE" });
    this.joinRealmButton = page.locator("button", { hasText: "JOIN" });
    this.loadingSpinner = page.getByTestId("loading-spinner");
  }

  public async leaveRealm(): Promise<void> {
    await this.leaveRealmButton.click();
    await this.loadingSpinner.waitFor({ state: "visible" });
    await this.loadingSpinner.waitFor({ state: "hidden" });
  }

  public async joinRealm(): Promise<void> {
    this.page.on("dialog", (dialog) => dialog.accept());
    await this.joinRealmButton.click();
    await this.loadingSpinner.waitFor({ state: "visible" });
    await this.loadingSpinner.waitFor({ state: "hidden" });
  }
}
