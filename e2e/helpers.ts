import { Page } from "@playwright/test";

function patternMatches(message: string, pattern: string | RegExp): boolean {
    return typeof pattern === "string"
        ? message.includes(pattern)
        : pattern.test(message);
}

async function respondToPopup(
    page: Page,
    expectedPattern: string | RegExp,
    response: string | ((message: string) => string),
): Promise<void> {
    const promptDialog = page.getByTestId("popup-prompt");
    const confirmDialog = page.getByTestId("popup-confirm");

    await Promise.race([
        promptDialog.waitFor({ state: "visible", timeout: 15000 }),
        confirmDialog.waitFor({ state: "visible", timeout: 15000 }),
    ]);

    if (await promptDialog.isVisible()) {
        const message =
            (await page.getByTestId("popup-prompt-message").textContent()) ??
            "";
        if (!patternMatches(message, expectedPattern)) {
            await page.getByTestId("popup-prompt-cancel").click();
            throw new Error(
                `Unexpected prompt message: "${message}". Expected pattern: ${expectedPattern}`,
            );
        }
        const responseText =
            typeof response === "function" ? response(message) : response;
        if (responseText) {
            await page.getByTestId("popup-prompt-input").fill(responseText);
        }
        await page.getByTestId("popup-prompt-ok").click();
    } else {
        const message =
            (await page.getByTestId("popup-confirm-message").textContent()) ??
            "";
        if (!patternMatches(message, expectedPattern)) {
            await page.getByTestId("popup-confirm-cancel").click();
            throw new Error(
                `Unexpected confirm message: "${message}". Expected pattern: ${expectedPattern}`,
            );
        }
        await page.getByTestId("popup-confirm-ok").click();
    }

    // Wait for the modal to close before returning so the next dialog (if any)
    // shows up cleanly.
    await Promise.all([
        promptDialog
            .waitFor({ state: "hidden", timeout: 5000 })
            .catch(() => {}),
        confirmDialog
            .waitFor({ state: "hidden", timeout: 5000 })
            .catch(() => {}),
    ]);
}

export async function handleDialog(
    page: Page,
    expectedMessagePattern: string | RegExp,
    response: string | ((message: string) => string),
    triggerAction: () => Promise<void>,
): Promise<void> {
    await triggerAction();
    await respondToPopup(page, expectedMessagePattern, response);
}

export async function handleDialogSequence(
    page: Page,
    dialogs: Array<{
        expectedPattern: string | RegExp;
        response: string | ((message: string) => string);
    }>,
    triggerAction: () => Promise<void>,
): Promise<void> {
    await triggerAction();
    for (const { expectedPattern, response } of dialogs) {
        await respondToPopup(page, expectedPattern, response);
    }
}

export async function retryOperation<T>(
    operation: () => Promise<T>,
    options: {
        maxAttempts?: number;
        initialDelay?: number;
        maxDelay?: number;
        backoffMultiplier?: number;
        shouldRetry?: (error: Error, attempt: number) => boolean;
    } = {},
): Promise<T> {
    const {
        maxAttempts = 3,
        initialDelay = 1000,
        maxDelay = 10000,
        backoffMultiplier = 2,
        shouldRetry = () => true,
    } = options;

    let lastError: Error;
    let delay = initialDelay;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await operation();
        } catch (error) {
            lastError =
                error instanceof Error ? error : new Error(String(error));

            if (attempt === maxAttempts || !shouldRetry(lastError, attempt)) {
                throw lastError;
            }

            await new Promise((resolve) => setTimeout(resolve, delay));
            delay = Math.min(delay * backoffMultiplier, maxDelay);
        }
    }

    throw lastError!;
}

export async function waitForCondition(
    checkCondition: () => Promise<boolean>,
    options: {
        timeout?: number;
        interval?: number;
        errorMessage?: string;
    } = {},
): Promise<void> {
    const {
        timeout = 30000,
        interval = 500,
        errorMessage = "Condition not met within timeout",
    } = options;

    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
        if (await checkCondition()) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, interval));
    }

    throw new Error(errorMessage);
}

export async function waitForUILoading(
    page: Page,
    options: {
        timeout?: number;
    } = {},
): Promise<void> {
    const { timeout = 15000 } = options;

    await page.waitForLoadState("networkidle", { timeout });
    // Wait for the app to actually render (#app becomes visible when
    // applyTheme() runs during App(), the last step of bootstrap).
    // Skip this check on the recovery page which bypasses normal bootstrap.
    if (!page.url().includes("recovery")) {
        await page.locator("#app").waitFor({ state: "visible", timeout });
    }
    await page.waitForTimeout(500);
}

export async function createAuctionBid(
    page: Page,
    icpPerToken: string,
    tokenAmount: string,
    transferICPFn: (address: string, amount: number) => void,
    icpAddress: string,
): Promise<void> {
    await page.goto("/#/tokens");
    await waitForUILoading(page);
    await page.getByPlaceholder("ICP per 1 TAGGR").fill(icpPerToken);
    await page.getByPlaceholder("Number of TAGGR tokens").fill(tokenAmount);
    transferICPFn(
        icpAddress,
        parseFloat(icpPerToken) * parseFloat(tokenAmount),
    );
    await page
        .getByRole("button", { name: `BID FOR ${tokenAmount} TAGGR` })
        .click();
    await waitForUILoading(page);
    await page.getByText("Current Bids").waitFor({ state: "visible" });
}

export async function safeClick(
    page: Page,
    selector: string,
    options: {
        timeout?: number;
        waitForNavigation?: boolean;
    } = {},
): Promise<void> {
    const { timeout = 10000, waitForNavigation = false } = options;

    const element = page.locator(selector);
    await element.waitFor({ state: "visible", timeout });
    await element.waitFor({ state: "attached", timeout });

    if (waitForNavigation) {
        await Promise.all([
            page.waitForLoadState("networkidle"),
            element.click(),
        ]);
    } else {
        await element.click();
    }
}

export async function fillAndSubmit(
    page: Page,
    selector: string,
    value: string,
    submitSelector: string,
): Promise<void> {
    await page.locator(selector).waitFor({ state: "visible" });
    await page.locator(selector).fill(value);
    await page.locator(submitSelector).click();
}

export async function waitForTextContent(
    page: Page,
    selector: string,
    expectedText: string | RegExp,
    options: {
        timeout?: number;
    } = {},
): Promise<void> {
    const { timeout = 10000 } = options;
    const maxAttempts = Math.ceil(timeout / 500);

    await pollForCondition(
        async () => {
            const element = page.locator(selector).first();
            const count = await element.count();
            if (count === 0) return false;
            const text = await element.textContent();
            if (!text) return false;
            return typeof expectedText === "string"
                ? text.includes(expectedText)
                : new RegExp(expectedText).test(text);
        },
        {
            maxAttempts,
            interval: 500,
            errorMessage: `Text content "${expectedText}" not found in selector "${selector}" within ${timeout}ms`,
        },
    );
}

export async function pollForCondition(
    checkCondition: () => Promise<boolean>,
    options: {
        maxAttempts?: number;
        interval?: number;
        errorMessage?: string;
    } = {},
): Promise<void> {
    const {
        maxAttempts = 20,
        interval = 2000,
        errorMessage = "Condition not met after polling",
    } = options;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (await checkCondition()) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, interval));
    }

    throw new Error(errorMessage);
}
