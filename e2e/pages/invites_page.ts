import { Locator, Page, expect } from "@playwright/test";

export class InvitesPage {
    private readonly createInviteButton: Locator;
    private readonly inviteCreditsInput: Locator;
    private readonly openInvites: Locator;

    private existingInvites: string[] = [];

    constructor(private readonly page: Page) {
        this.createInviteButton = page.locator("button", { hasText: "CREATE" });
        this.inviteCreditsInput = page.locator("input").locator("visible=true");
        this.openInvites = page.locator("code", {
            hasText: /\/#\/welcome\/.*/,
        });
    }

    public async getOpenInvites(): Promise<string[]> {
        let openInvites: string[] = [];
        for (const invite of await this.openInvites.all()) {
            const inviteUrl = await invite.innerText();

            openInvites.push(inviteUrl);
        }

        return openInvites;
    }

    public async createInviteWithCredits(
        credits: number = 50,
    ): Promise<string> {
        await this.inviteCreditsInput.fill(String(credits));
        await this.createInviteButton.click();
        // wait for the update and read_state calls to complete
        await this.page.waitForResponse("**/query", { timeout: 6000 });

        let newInvites: string[] = [];
        for (const invite of await this.openInvites.all()) {
            const inviteUrl = await invite.innerText();

            if (this.existingInvites.includes(inviteUrl)) {
                continue;
            }

            newInvites.push(inviteUrl);
        }

        expect(newInvites).toHaveLength(1);
        const newInviteUrl = newInvites[0];
        this.existingInvites.push(newInviteUrl);

        const invitePath = newInviteUrl.split("#").pop();
        return `/#${invitePath}`;
    }
}
