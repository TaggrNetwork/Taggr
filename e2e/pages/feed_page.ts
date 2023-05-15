import { Locator, Page } from "@playwright/test";

export class FeedPage {
  private readonly postArticles: Locator;

  constructor(private readonly page: Page) {
    this.postArticles = page.getByRole("article");
  }

  public async goto(tag: string): Promise<void> {
    await this.page.goto(`/#/feed/${tag}`);
  }

  public async getPostByContent(content: string): Promise<Locator> {
    return this.postArticles.filter({ hasText: content });
  }
}
