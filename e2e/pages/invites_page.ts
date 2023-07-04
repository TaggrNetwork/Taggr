import { Locator, Page, expect } from "@playwright/test";

export class InvitesPage {
    private readonly createInviteButton: Locator;
    private readonly inviteCyclesInput: Locator;
    private readonly loadingSpinner: Locator;
    private readonly openInvites: Locator;

    private existingInvites: string[] = [];

    constructor(page: Page) {
        this.createInviteButton = page.locator("button", { hasText: "CREATE" });
        this.inviteCyclesInput = page.locator("input").locator("visible=true");
        this.loadingSpinner = page.getByTestId("loading-spinner");
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

    public async createInviteWithCycles(cycles: number = 50): Promise<string> {
        await this.inviteCyclesInput.fill(String(cycles));
        await this.createInviteButton.click();
        await this.loadingSpinner.waitFor({ state: "visible" });
        await this.loadingSpinner.waitFor({ state: "hidden" });

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
