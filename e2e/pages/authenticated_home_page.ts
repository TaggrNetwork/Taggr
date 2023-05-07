import { Locator, Page } from "@playwright/test";

export class AuthenticatedHomePage {
  public readonly burgerButton: Locator;

  constructor(page: Page) {
    this.burgerButton = page.getByTestId("burger-button");
  }
}
