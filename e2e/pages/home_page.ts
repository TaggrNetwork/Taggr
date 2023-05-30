import { Locator, Page } from "@playwright/test";
import { InternetIdentityPage } from "./internet_identity_page";
import { PostElement } from "../elements";

export class HomePage {
  public readonly welcomeAboardHeader: Locator;
  public readonly connectButton: Locator;
  private readonly loginWithInternetIdentityButton: Locator;
  private readonly loginWithSeedPhraseButton: Locator;
  private readonly seedPhraseInput: Locator;
  private readonly seedPhraseJoinButton: Locator;
  private readonly newPostsTab: Locator;
  private readonly posts: Locator;

  constructor(private readonly page: Page) {
    this.welcomeAboardHeader = page.locator("h1");
    this.connectButton = page.locator("button", {
      hasText: "CONNECT",
    });
    this.loginWithInternetIdentityButton = page.locator("button", {
      hasText: "VIA INTERNET IDENTITY",
    });
    this.loginWithSeedPhraseButton = page.locator("button", {
      hasText: "VIA PASSWORD",
    });
    this.seedPhraseInput = page.getByPlaceholder("Enter your password");
    this.seedPhraseJoinButton = page.locator("button", { hasText: "JOIN" });
    this.newPostsTab = page
      .locator("button", { hasText: "NEW" })
      .locator("visible=true");
    this.posts = page.getByTestId("post-body").locator("visible=true");
  }

  public async goto(): Promise<void> {
    await this.page.goto("/#/");
  }

  public async openInternetIdentityLoginPage(): Promise<InternetIdentityPage> {
    await this.connectButton.click();

    const [internetIdentityPopup] = await Promise.all([
      this.page.waitForEvent("popup"),
      this.loginWithInternetIdentityButton.click(),
    ]);

    return new InternetIdentityPage(internetIdentityPopup);
  }

  public async loginWithSeedPhrase(seedPhrase: string): Promise<void> {
    await this.connectButton.click();
    await this.loginWithSeedPhraseButton.click();

    await this.seedPhraseInput.fill(seedPhrase);
    await this.seedPhraseJoinButton.click();

    // confirm seed phrase
    await this.seedPhraseInput.fill(seedPhrase);
    await this.seedPhraseJoinButton.click();
  }

  public async showNewPosts(): Promise<void> {
    await this.newPostsTab.click();
  }

  public async getPostByContent(content: string): Promise<PostElement> {
    return new PostElement(this.page, this.posts.filter({ hasText: content }));
  }
}
