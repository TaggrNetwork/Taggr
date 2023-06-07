import { Locator, Page, expect } from "@playwright/test";
import { generateText } from "../support";
import { PostEditorElement } from "./post_editor_element";
import { PostPage } from "../pages";

export enum PostReaction {
  Heart = 10,
  ThumbsDown = 1,
  Fire = 50,
  Laughing = 51,
  Star = 100,
}

export class PostElement {
  public readonly editor: PostEditorElement;
  private readonly infoToggleButton: Locator;
  private readonly commentsToggleButton: Locator;
  private readonly commentInput: Locator;
  private readonly loadingSpinner: Locator;
  private readonly comments: Locator;
  private readonly bookmarkButton: Locator;
  private readonly linkButton: Locator;

  constructor(private readonly page: Page, public readonly element: Locator) {
    this.editor = new PostEditorElement(page, element.locator("form"));
    this.infoToggleButton = element.getByTestId("post-info-toggle");
    this.commentsToggleButton = element.getByTestId("post-comments-toggle");
    this.commentInput = element.getByPlaceholder("Reply here...");
    this.loadingSpinner = element
      .getByTestId("loading-spinner")
      .locator("visible=true");
    this.comments = element.getByTestId("post-body");
    this.bookmarkButton = element.getByTestId("bookmark-post");
    this.linkButton = element.locator("a", { hasText: "#" });
  }

  public async giveComment(): Promise<string> {
    await this.infoToggleButton.click();
    await this.commentInput.focus();

    const text = generateText();
    await this.editor.addText(text);

    const content = await this.editor.getContent();

    await this.editor.submit();
    await this.loadingSpinner.waitFor({ state: "visible" });
    await this.loadingSpinner.waitFor({ state: "hidden" });

    return content;
  }

  public getCommentByContent(content: string): PostElement {
    return new PostElement(
      this.page,
      this.comments.filter({ hasText: content })
    );
  }

  public async goToPostPage(): Promise<PostPage> {
    await this.infoToggleButton.click();
    await this.linkButton.click();
    expect(new URL(this.page.url()).hash).toMatch(/#\/post\/\d+/);

    return new PostPage(this.page);
  }

  public async toggleComments(): Promise<void> {
    return await this.commentsToggleButton.click();
  }

  public async toggleBookmark(): Promise<void> {
    await this.infoToggleButton.click();
    await this.bookmarkButton.click();
    // wait for the update and read_state calls to complete
    await this.page.waitForResponse("**/query", { timeout: 6000 });
  }

  public getHeartReaction(): Locator {
    return this.getReaction(PostReaction.Heart);
  }

  public getFireReaction(): Locator {
    return this.getReaction(PostReaction.Fire);
  }

  public async giveHeartReaction(): Promise<void> {
    return await this.giveReaction(PostReaction.Heart);
  }

  public async giveFireReaction(): Promise<void> {
    return await this.giveReaction(PostReaction.Fire);
  }

  private getReaction(reaction: PostReaction): Locator {
    return this.element.getByTestId(`${reaction}-reaction`);
  }

  private async giveReaction(reaction: PostReaction): Promise<void> {
    await this.infoToggleButton.click();

    const heartReactionButton = this.element.getByTestId(
      `give-${reaction}-reaction`
    );
    await heartReactionButton.click();

    // wait 4 seconds for the reaction "grace period"
    await this.page.waitForTimeout(4000);
    // wait for the update and read_state calls to complete
    await this.page.waitForResponse("**/query", { timeout: 6000 });
  }
}
