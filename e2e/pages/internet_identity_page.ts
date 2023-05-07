import { Locator, Page } from "@playwright/test";

export class InternetIdentityPage {
  private readonly createAnchorButton: Locator;

  private readonly deviceNameInput: Locator;
  private readonly createDeviceButton: Locator;

  private readonly captchaInput: Locator;
  private readonly confirmCaptchaButton: Locator;

  private readonly readonlyAnchorInput: Locator;
  private readonly anchorContinueButton: Locator;

  private readonly addRecoveryLaterButton: Locator;
  private readonly confirmAddRecoveryLaterButton: Locator;

  constructor(page: Page) {
    this.createAnchorButton = page.locator("button", {
      hasText: "Create New Identity Anchor",
    });

    this.deviceNameInput = page.getByPlaceholder("Device name");
    this.createDeviceButton = page.locator("button", { hasText: "Create" });

    this.captchaInput = page.locator("input#captchaInput");
    this.confirmCaptchaButton = page.locator("button", { hasText: "Confirm" });

    this.readonlyAnchorInput = page.locator(
      "label:has-text('Identity Anchor:') + div"
    );
    this.anchorContinueButton = page.locator("button", { hasText: "Continue" });

    this.addRecoveryLaterButton = page.locator("button", {
      hasText: "Add recovery later",
    });
    this.confirmAddRecoveryLaterButton = page.locator("button", {
      hasText: "Skip, I understand the risks",
    });
  }

  public async createAnchor(): Promise<string> {
    await this.createAnchorButton.click();

    // device name can be anything
    await this.deviceNameInput.fill("e2eTestDevice");
    await this.createDeviceButton.click();

    // the captcha is always "a" when II is in dev mode
    await this.captchaInput.fill("a");
    await this.confirmCaptchaButton.click();

    const anchor = await this.readonlyAnchorInput.textContent();
    await this.anchorContinueButton.click();

    await this.addRecoveryLaterButton.click();
    await this.confirmAddRecoveryLaterButton.click();

    return anchor;
  }
}
