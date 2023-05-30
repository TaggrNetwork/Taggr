import { Locator, Page } from "@playwright/test";

export class PostEditorElement {
  public readonly cycleCost: Locator;
  private readonly sendButton: Locator;
  private readonly inputTextArea: Locator;
  private readonly filePickerButton: Locator;

  constructor(private readonly page: Page, readonly element: Locator) {
    this.cycleCost = element.getByTestId("cycle-cost");
    this.sendButton = element.locator("button", { hasText: "SEND" });
    this.inputTextArea = element.locator("textarea");
    this.filePickerButton = element.getByTestId("file-picker");
  }

  public async addText(text: string): Promise<void> {
    const currentContent = await this.inputTextArea.inputValue();

    await this.inputTextArea.fill(currentContent + text);
  }

  public async addImage(imagePath: string): Promise<void> {
    const [fileChooser] = await Promise.all([
      this.page.waitForEvent("filechooser"),
      this.filePickerButton.click(),
    ]);

    await fileChooser.setFiles([imagePath]);
  }

  public async getContent(): Promise<string> {
    const postContent = await this.inputTextArea.inputValue();

    // remove image tags from content since they're not "visible"
    return postContent.replace(/!\[.*\]\(.*\)/, "");
  }

  public async submit(): Promise<void> {
    await this.sendButton.click();
  }
}
