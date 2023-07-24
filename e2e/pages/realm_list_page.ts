import { Locator, Page, expect } from "@playwright/test";
import { NewRealmPage } from "./new_realm_page";
import { RealmPage } from "./realm_page";

export class RealmListPage {
    private readonly createButton: Locator;
    private readonly moreButton: Locator;

    constructor(private readonly page: Page) {
        this.createButton = page.locator("button", { hasText: "CREATE" });
        this.moreButton = page.locator("button", { hasText: "MORE" });
    }

    public async createNewRealm(): Promise<NewRealmPage> {
        await this.createButton.click();
        expect(new URL(this.page.url()).hash).toEqual("#/realms/create");

        return new NewRealmPage(this.page);
    }

    public async goToRealm(realmName: string): Promise<RealmPage> {
        const realmLink = this.page.locator("a", {
            hasText: new RegExp(`^${realmName.toUpperCase()}$`),
        });

        while (
            !(await realmLink.isVisible()) &&
            (await this.moreButton.isVisible())
        ) {
            await this.moreButton.click();
            // wait for the update and read_state calls to complete
            await this.page.waitForResponse("**/query", { timeout: 6000 });
        }

        await realmLink.click();

        await this.page.waitForURL(`/#/realm/${realmName.toUpperCase()}`, {
            timeout: 6000,
        });
        return new RealmPage(this.page, realmName);
    }
}
