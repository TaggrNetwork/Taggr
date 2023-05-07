import { Locator, Page } from "@playwright/test";

export class SettingsPage {
  private readonly usernameInput: Locator;
  private readonly saveButton: Locator;

  constructor(page: Page) {
    this.usernameInput = page.locator("div:has-text('USER NAME') + input");
    this.saveButton = page.locator("button", { hasText: "SAVE" });
  }

  public async setUsername(username: string): Promise<void> {
    await this.usernameInput.fill(username);
  }

  public async save(): Promise<void> {
    await this.saveButton.click();
  }
}
