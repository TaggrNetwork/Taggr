import { Locator, Page } from "@playwright/test";

export class ProposalElement {
  public readonly statusElement: Locator;
  private readonly loadingSpinner: Locator;
  private readonly acceptButton: Locator;
  private readonly rejectButton: Locator;

  constructor(private readonly page: Page, public readonly element: Locator) {
    this.loadingSpinner = element.getByTestId("loading-spinner");
    this.acceptButton = element.locator("button", { hasText: "ACCEPT" });
    this.rejectButton = element.locator("button", { hasText: "REJECT" });
    this.statusElement = element.locator("div:has-text('STATUS') > span");
  }

  public async accept(buildHash: string): Promise<void> {
    this.page.on("dialog", (dialog) => dialog.accept(buildHash));
    await this.acceptButton.click();

    await this.loadingSpinner.waitFor({ state: "visible" });
    await this.loadingSpinner.waitFor({ state: "hidden" });
  }

  public async reject(): Promise<void> {
    await this.rejectButton.click();

    await this.loadingSpinner.waitFor({ state: "visible" });
    await this.loadingSpinner.waitFor({ state: "hidden" });
  }
}
