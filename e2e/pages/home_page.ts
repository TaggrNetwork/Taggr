import { Locator, Page } from "@playwright/test";

export class HomePage {
  public readonly welcomeAboardHeader: Locator;

  constructor(private readonly page: Page) {
    this.welcomeAboardHeader = page.locator("h1");
  }

  public async goto(): Promise<void> {
    await this.page.goto("/");
  }
}
