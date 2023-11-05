import { Locator, Page } from "@playwright/test";

export class RecoveryPage {
    private readonly binaryFilePickerButton: Locator;
    private readonly hashSubmitButton: Locator;
    public readonly status: Locator;
    public readonly supportersHeader: Locator;
    public readonly hashInput: Locator;

    constructor(readonly page: Page) {
        this.binaryFilePickerButton = page.locator('input[type="file"]');
        this.hashSubmitButton = page.locator("button", {
            hasText: "SUBMIT HASH",
        });
        this.status = page.getByTestId("status");
        this.supportersHeader = page.getByTestId("supporters");
        this.hashInput = page.getByTestId("hash-input");
    }

    public async supportBinary(hash: string): Promise<void> {
        return new Promise((resolve, _reject) => {
            this.page.on("dialog", (dialog) => {
                if (dialog.message().includes("submitted")) {
                    dialog.accept();
                    resolve();
                }
            });
            this.hashInput.fill(hash);
            this.hashSubmitButton.click();
        });
    }

    public async uploadEmergencyRelease(binaryPath: string): Promise<void> {
        const [fileChooser] = await Promise.all([
            this.page.waitForEvent("filechooser"),
            this.binaryFilePickerButton.click(),
        ]);
        return new Promise((resolve, _reject) => {
            this.page.on("dialog", (dialog) => {
                let msg = dialog.message();
                if (msg.includes("Do you")) dialog.accept();
                if (msg.includes("Done")) {
                    dialog.accept();
                    resolve();
                }
            });
            fileChooser.setFiles([binaryPath]);
        });
    }
}
