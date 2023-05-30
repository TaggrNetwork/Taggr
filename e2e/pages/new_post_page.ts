import { Page } from "@playwright/test";
import { PostEditorElement } from "../elements";
import { PostPage } from "./post_page";

export class NewPostPage {
  public readonly editor: PostEditorElement;

  constructor(private readonly page: Page) {
    this.editor = new PostEditorElement(page, page.locator("form"));
  }

  public async submit(): Promise<PostPage> {
    await this.editor.submit();

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
