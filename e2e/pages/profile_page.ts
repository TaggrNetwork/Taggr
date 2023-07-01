import { Locator, Page } from "@playwright/test";
import { CommonUser, textToNumber } from "../support";
import { PostElement } from "../elements";

export class ProfilePage {
    private readonly cycles: Locator;
    private readonly newKarma: Locator;
    private readonly postCount: Locator;
    private readonly tokenBalance: Locator;
    private readonly posts: Locator;
    private readonly tagsTab: Locator;
    private readonly rewardedPostsTab: Locator;

    constructor(
        private readonly page: Page,
        private readonly user: CommonUser
    ) {
        this.cycles = page
            .locator("div:has-text('CYCLES') > code")
            .locator("visible=true");
        this.newKarma = page
            .locator("div:has-text('NEW KARMA') > code")
            .locator("visible=true");
        this.postCount = page
            .locator("div:has-text('POSTS') > code")
            .locator("visible=true");
        this.tokenBalance = page
            .locator("div:has-text('TOKENS') > code")
            .locator("visible=true");
        this.posts = page.getByTestId("post-body").locator("visible=true");
        this.tagsTab = page
            .locator("button", { hasText: "TAGS" })
            .locator("visible=true");
        this.rewardedPostsTab = page
            .locator("button", { hasText: "REWARDED" })
            .locator("visible=true");
    }

    public async showTagPosts(): Promise<void> {
        await this.tagsTab.click();
    }

    public async showRewardedPosts(): Promise<void> {
        await this.rewardedPostsTab.click();
    }

    public async goto(): Promise<void> {
        await this.page.goto(`/#/user/${this.user.username}`);
    }

    public async getCyclesBalance(): Promise<number> {
        const cyclesString = await this.cycles.innerText();

        return textToNumber(cyclesString);
    }

    public async getNewKarmaBalance(): Promise<number> {
        const newKarmaString = await this.newKarma.innerText();

        return textToNumber(newKarmaString);
    }

    public async getPostCount(): Promise<number> {
        const postCountString = await this.postCount.innerText();

        return textToNumber(postCountString);
    }

    public async getTokenBalance(): Promise<number> {
        const tokenBalanceString = await this.tokenBalance.innerText();

        return textToNumber(tokenBalanceString);
    }

    public async getPostByContent(content: string): Promise<PostElement> {
        return new PostElement(
            this.page,
            this.posts.filter({ hasText: content })
        );
    }
}
