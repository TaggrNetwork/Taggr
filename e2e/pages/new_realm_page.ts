import { Locator, Page } from "@playwright/test";
import { generateRealmName, generateText } from "../support";
import { RealmPage } from "./realm_page";

export class NewRealmPage {
    private readonly realmNameInput: Locator;
    private readonly realmDescriptionInput: Locator;
    private readonly createButton: Locator;

    constructor(private readonly page: Page) {
        this.realmNameInput = page.getByPlaceholder("ALPHANUMERIC");
        this.realmDescriptionInput = page.locator(
            "textarea:near(div:has-text('DESCRIPTION'))",
        );
        this.createButton = page
            .locator("button", { hasText: "CREATE" })
            .locator("visible=true");
    }

    public async fillAndSaveRealmForm(): Promise<[RealmPage, string, string]> {
        const realmName = generateRealmName();
        const realmDescription = generateText();

        await this.realmNameInput.fill(realmName);
        await this.realmDescriptionInput.fill(realmDescription);
        await this.createButton.click();

        await this.page.waitForURL(`/#/realm/${realmName.toUpperCase()}`);
        return [
            new RealmPage(this.page, realmName),
            realmName,
            realmDescription,
        ];
    }
}
