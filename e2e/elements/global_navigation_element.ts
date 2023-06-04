import { Locator, Page, expect } from "@playwright/test";
import { CommonUser } from "../support";
import {
  ProfilePage,
  HomePage,
  NewPostPage,
  InvitesPage,
  WalletPage,
  RealmListPage,
  RealmPage,
  BookmarksPage,
  JournalPage,
} from "../pages";

export class GlobalNavigationElement {
  public readonly toggleRealmsButton: Locator;
  private readonly burgerButton: Locator;
  private readonly homeLink: Locator;
  private readonly profileLink: Locator;
  private readonly invitesLink: Locator;
  private readonly walletLink: Locator;
  private readonly realmsLink: Locator;
  private readonly bookmarksLink: Locator;
  private readonly journalLink: Locator;
  private readonly postButton: Locator;

  constructor(private readonly page: Page, private readonly user?: CommonUser) {
    this.burgerButton = page.getByTestId("burger-button");
    this.homeLink = page.getByTestId("home-page-link");
    this.profileLink = page
      .locator("a:near(header)", {
        hasText: user?.username ?? "",
      })
      .locator("visible=true");
    this.invitesLink = page.locator("a", { hasText: "INVITES" });
    this.walletLink = page.locator("a", { hasText: "WALLET" });
    this.realmsLink = page.locator("a", { hasText: "REALMS" });
    this.bookmarksLink = page.locator("a", { hasText: "BOOKMARKS" });
    this.journalLink = page.locator("a", { hasText: "JOURNAL" });
    this.postButton = page.locator("button", { hasText: "POST" });
    this.toggleRealmsButton = page.getByTestId("toggle-realms");
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
    expect(new URL(this.page.url()).hash).toEqual("#/new");

    return new NewPostPage(this.page);
  }

  public async goToRealmsPage(): Promise<RealmListPage> {
    await this.burgerButton.click();
    await this.realmsLink.click();
    expect(new URL(this.page.url()).hash).toEqual("#/realms");

    return new RealmListPage(this.page);
  }

  public async goToBookmarksPage(): Promise<BookmarksPage> {
    await this.burgerButton.click();
    await this.bookmarksLink.click();
    expect(new URL(this.page.url()).hash).toEqual("#/bookmarks");

    return new BookmarksPage(this.page);
  }

  public async goToJournalPage(): Promise<JournalPage> {
    await this.burgerButton.click();
    await this.journalLink.click();
    expect(new URL(this.page.url()).hash).toEqual(
      `#/journal/${this.user?.username ?? ""}`
    );

    return new JournalPage(this.page);
  }

  public async enterRealm(realmName: string): Promise<RealmPage> {
    await this.toggleRealmsButton.click();
    await this.page
      .locator("span:near(header)", {
        hasText: new RegExp(`^${realmName.toUpperCase()}$`),
      })
      .locator("visible=true")
      .click();

    await this.page.waitForURL(`/#/${realmName.toUpperCase()}/home/`);
    return new RealmPage(this.page, realmName);
  }
}
