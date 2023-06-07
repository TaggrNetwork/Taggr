import { Locator, Page } from "@playwright/test";
import { HomePage } from "./home_page";

export class SettingsPage {
  private readonly usernameInput: Locator;
  private readonly aboutYouInput: Locator;
  private readonly saveButton: Locator;

  constructor(private readonly page: Page) {
    this.usernameInput = page.locator("div:has-text('USER NAME') + input");
    this.aboutYouInput = page.locator("div:has-text('ABOUT YOU') + input");
    this.saveButton = page.locator("button", { hasText: "SAVE" });
  }

  public async setUsername(username: string): Promise<void> {
    await this.usernameInput.fill(username);
  }

  public async setAboutYou(aboutYou: string): Promise<void> {
    await this.aboutYouInput.fill(aboutYou);
  }

  public async save(): Promise<HomePage> {
    await this.saveButton.click();
    await this.page.waitForURL("/");

    return new HomePage(this.page);
  }
}
