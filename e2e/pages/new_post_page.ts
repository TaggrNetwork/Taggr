import { Locator, Page } from "@playwright/test";

export class NewPostPage {
  public readonly cycleCost: Locator;
  private readonly inputTextArea: Locator;
  private readonly sendButton: Locator;

  constructor(private readonly page: Page) {
    this.cycleCost = page.getByTestId("cycle-cost");
    this.inputTextArea = page.locator("textarea");
    this.sendButton = page.locator("button", { hasText: "SEND" });
  }

  public async addPostTextContent(textContent: string): Promise<string> {
    const currentContent = await this.inputTextArea.textContent();

    await this.inputTextArea.fill(currentContent + textContent);

    return await this.inputTextArea.textContent();
  }

  public async getPostContent(): Promise<string> {
    return await this.inputTextArea.inputValue();
  }

  public async submit(): Promise<void> {
    await this.sendButton.click();

    // since this navigation is asynchronous and not a result of directly
    // clicking an anchor tag, Playwright does not know that it needs to wait
    await this.page.waitForURL("**/#/post/*");
  }
}
