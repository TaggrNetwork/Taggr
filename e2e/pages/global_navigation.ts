import { Locator, Page, expect } from "@playwright/test";
import { ProfilePage } from "./profile_page";
import { CommonUser } from "../support";
import { HomePage } from "./home_page";
import { NewPostPage } from "./new_post_page";

export class GlobalNavigation {
  public readonly burgerButton: Locator;
  private readonly homeLink: Locator;
  private readonly profileLink: Locator;
  private readonly postButton: Locator;

  constructor(private readonly page: Page, private readonly user: CommonUser) {
    this.burgerButton = page.getByTestId("burger-button");
    this.homeLink = page.getByTestId("home-page-link");
    this.profileLink = page.locator("a:near(header)", {
      hasText: user.username,
    });
    this.postButton = page.locator("button", { hasText: "POST" });
  }

  public async goToHomePage(): Promise<HomePage> {
    await this.homeLink.click();
    expect(new URL(this.page.url()).hash).toEqual("#/");

    return new HomePage(this.page);
  }

  public async goToProfilePage(): Promise<ProfilePage> {
    await this.burgerButton.click();
    await this.profileLink.click();
    expect(new URL(this.page.url()).hash).toEqual(
      `#/user/${this.user.username}`
    );

    return new ProfilePage(this.page, this.user);
  }

  public async createNewPost(): Promise<NewPostPage> {
    await this.postButton.click();
    expect(new URL(this.page.url()).hash).toEqual(`#/new`);

    return new NewPostPage(this.page);
  }
}
