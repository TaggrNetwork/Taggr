import { Locator, Page } from "@playwright/test";

export class PostPage {
    public readonly postBody: Locator;
    public readonly imagePreview: Locator;

    constructor(private readonly page: Page) {
        this.postBody = page.getByTestId("post-body");
        this.imagePreview = page.getByTestId("image-preview");
    }

    public getPostId(): string {
        const [_, postId] = this.page.url().match(/\/#\/post\/(\d+)/);

        return postId;
    }

    public getElementByValue(value: string): Locator {
        return this.page.getByText(value);
    }
}
