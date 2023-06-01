import { Locator, Page, expect } from "@playwright/test";
import { CommonUser } from "../support";
import {
  ProfilePage,
  HomePage,
  NewPostPage,
  InvitesPage,
  WalletPage,
} from "../pages";

export class GlobalNavigationElement {
  public readonly burgerButton: Locator;
  private readonly homeLink: Locator;
  private readonly profileLink: Locator;
  private readonly invitesLink: Locator;
  private readonly walletLink: Locator;
  private readonly postButton: Locator;

  constructor(private readonly page: Page, private readonly user?: CommonUser) {
    this.burgerButton = page.getByTestId("burger-button");
    this.homeLink = page.getByTestId("home-page-link");
    this.profileLink = page.locator("a:near(header)", {
      hasText: user?.username ?? "",
    });
    this.invitesLink = page.locator("a", { hasText: "INVITES" });
    this.walletLink = page.locator("a", { hasText: "WALLET" });
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
      `#/user/${this.user?.username ?? ""}`
    );

    return new ProfilePage(this.page, this.user);
  }

  public async goToInvitesPage(): Promise<InvitesPage> {
    await this.burgerButton.click();
    await this.invitesLink.click();
    expect(new URL(this.page.url()).hash).toEqual("#/invites");

    return new InvitesPage(this.page);
  }

  public async goToWalletPage(): Promise<WalletPage> {
    await this.burgerButton.click();
    await this.walletLink.click();
    expect(new URL(this.page.url()).hash).toEqual("#/wallet");

    return new WalletPage(this.page);
  }

  public async goToNewPostPage(): Promise<NewPostPage> {
    await this.postButton.click();
    expect(new URL(this.page.url()).hash).toEqual(`#/new`);

    return new NewPostPage(this.page);
  }
}
