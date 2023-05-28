import { Locator, Page } from "@playwright/test";
import { PostPage } from "./post_page";

export class NewPostPage {
  public readonly cycleCost: Locator;
  private readonly inputTextArea: Locator;
  private readonly filePickerButton: Locator;
  private readonly sendButton: Locator;

  constructor(private readonly page: Page) {
    this.cycleCost = page.getByTestId("cycle-cost");
    this.inputTextArea = page.locator("textarea");
    this.filePickerButton = page.getByTestId("file-picker");
    this.sendButton = page.locator("button", { hasText: "SEND" });
  }

  public async addPostTextContent(textContent: string): Promise<string> {
    const currentContent = await this.inputTextArea.textContent();

    await this.inputTextArea.fill(currentContent + textContent);

    return await this.inputTextArea.textContent();
  }

  public async addImage(imagePath: string): Promise<void> {
    const [fileChooser] = await Promise.all([
      this.page.waitForEvent("filechooser"),
      this.filePickerButton.click(),
    ]);

    await fileChooser.setFiles([imagePath]);
  }

  public async getPostContent(): Promise<string> {
    const postContent = await this.inputTextArea.inputValue();

    // remove image tags from content since they're not "visible"
    return postContent.replace(/!\[.*\]\(.*\)/, "");
  }

  public async submit(): Promise<PostPage> {
    await this.sendButton.click();

    // since this navigation is asynchronous and not a result of directly
    // clicking an anchor tag, Playwright does not know that it needs to wait.
    // wait for network idle so we know any post images are finished loading
    await this.page.waitForURL("/#/post/*", {
      waitUntil: "networkidle",
      timeout: 4000,
    });

    return new PostPage(this.page);
  }
}
