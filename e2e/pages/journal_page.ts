import { Locator, Page } from "@playwright/test";
import { PostElement } from "../elements";

export class JournalPage {
    private readonly posts: Locator;

    constructor(readonly page: Page) {
        this.posts = page.getByTestId("post-body").locator("visible=true");
    }

    public async getPostByContent(content: string): Promise<PostElement> {
        return new PostElement(
            this.page,
            this.posts.filter({ hasText: content })
        );
    }
}
