import { Locator, Page } from "@playwright/test";

export class PostPage {
  public readonly postBody: Locator;
  public readonly imagePreview: Locator;

  constructor(page: Page) {
    this.postBody = page.getByTestId("post-body");
    this.imagePreview = page.getByTestId("image-preview");
  }
}
