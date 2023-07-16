import { Locator, Page } from "@playwright/test";
import { ProposalElement } from "../elements";

export class ProposalsPage {
    private readonly proposalsBurgerButton: Locator;
    private readonly createReleaseProposalButton: Locator;
    private readonly releaseCommitInput: Locator;
    private readonly binaryFilePickerButton: Locator;
    private readonly descriptionTextArea: Locator;
    private readonly submitButton: Locator;
    private readonly loadingSpinner: Locator;
    private readonly proposals: Locator;

    constructor(readonly page: Page) {
        this.proposalsBurgerButton = page.getByTestId(
            "proposals-burger-button",
        );
        this.createReleaseProposalButton = page.locator("button", {
            hasText: "RELEASE",
        });
        this.releaseCommitInput = page.locator(
            "div:has-text('COMMIT') > input",
        );
        this.binaryFilePickerButton = page.locator('input[type="file"]');
        this.descriptionTextArea = page.locator(
            "div:has-text('description') + textarea",
        );
        this.submitButton = page.locator("button", { hasText: "SUBMIT" });
        this.loadingSpinner = page.getByTestId("loading-spinner").first();
        this.proposals = page.getByTestId("post-body").locator("visible=true");
    }

    public async createReleaseProposal(
        commit: string,
        binaryPath: string,
        description: string,
    ): Promise<void> {
        await this.proposalsBurgerButton.click();
        await this.createReleaseProposalButton.click();

        await this.releaseCommitInput.fill(commit);
        const [fileChooser] = await Promise.all([
            this.page.waitForEvent("filechooser"),
            this.binaryFilePickerButton.click(),
        ]);
        await fileChooser.setFiles([binaryPath]);

        await this.descriptionTextArea.fill(description);

        await this.submitButton.click();
        await this.loadingSpinner.waitFor({ state: "visible" });
        await this.loadingSpinner.waitFor({ state: "hidden" });
    }

    public async getProposalByContent(
        proposalContent: string,
    ): Promise<ProposalElement> {
        const proposal = this.proposals.filter({ hasText: proposalContent });
        return new ProposalElement(this.page, proposal);
    }
}
