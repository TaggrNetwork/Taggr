import { Locator, Page } from "@playwright/test";

export class RealmPage {
    public readonly leaveRealmButton: Locator;
    public readonly joinRealmButton: Locator;
    public readonly burgerButton: Locator;
    public readonly closeButton: Locator;

    constructor(
        private readonly page: Page,
        public readonly realmName: string,
    ) {
        this.leaveRealmButton = page.locator("button", { hasText: "LEAVE" });
        this.joinRealmButton = page.locator("button", { hasText: "JOIN" });
        this.burgerButton = page.getByTestId("realm-burger-button");
        this.closeButton = page.getByTestId("realm-close-button");
    }

    public async leaveRealm(): Promise<void> {
        await this.leaveRealmButton.click();
        await this.joinRealmButton.waitFor({ state: "visible" });
    }

    public async joinRealm(): Promise<void> {
        this.page.on("dialog", (dialog) => dialog.accept());
        await this.joinRealmButton.click();
        await this.leaveRealmButton.waitFor({ state: "visible" });
    }
}
