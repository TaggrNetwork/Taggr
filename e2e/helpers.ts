import { Page, Dialog } from "@playwright/test";

export type DialogHandler = (dialog: Dialog) => Promise<void>;

export async function handleDialog(
    page: Page,
    expectedMessagePattern: string | RegExp,
    response: string | ((message: string) => string),
    triggerAction: () => Promise<void>,
): Promise<void> {
    const dialogPromise = new Promise<void>((resolve, reject) => {
        const handler = async (dialog: Dialog) => {
            try {
                const message = dialog.message();
                const matches =
                    typeof expectedMessagePattern === "string"
                        ? message.includes(expectedMessagePattern)
                        : expectedMessagePattern.test(message);

                if (matches) {
                    const responseText =
                        typeof response === "function"
                            ? response(message)
                            : response;
                    await dialog.accept(responseText);
                    resolve();
                } else {
                    await dialog.dismiss();
                    reject(
                        new Error(
                            `Unexpected dialog message: "${message}". Expected pattern: ${expectedMessagePattern}`,
                        ),
                    );
                }
            } catch (error) {
                reject(error);
            }
        };

        page.once("dialog", handler);
    });

    await triggerAction();
    await dialogPromise;
}

export async function handleDialogSequence(
    page: Page,
    dialogs: Array<{
        expectedPattern: string | RegExp;
        response: string | ((message: string) => string);
    }>,
    triggerAction: () => Promise<void>,
): Promise<void> {
    let dialogIndex = 0;
    const resolvers: Array<() => void> = [];
    const rejectors: Array<(error: Error) => void> = [];

    const dialogPromises = dialogs.map(
        () =>
            new Promise<void>((resolve, reject) => {
                resolvers.push(resolve);
                rejectors.push(reject);
            }),
    );

    const handler = async (dialog: Dialog) => {
        try {
            if (dialogIndex >= dialogs.length) {
                await dialog.dismiss();
                rejectors[0]?.(
                    new Error(`Unexpected extra dialog: ${dialog.message()}`),
                );
                return;
            }

            const { expectedPattern, response } = dialogs[dialogIndex];
            const message = dialog.message();
            const matches =
                typeof expectedPattern === "string"
                    ? message.includes(expectedPattern)
                    : expectedPattern.test(message);

            if (matches) {
                const responseText =
                    typeof response === "function"
                        ? response(message)
                        : response;
                await dialog.accept(responseText);
                resolvers[dialogIndex]?.();
                dialogIndex++;
            } else {
                await dialog.dismiss();
                rejectors[dialogIndex]?.(
                    new Error(
                        `Dialog ${dialogIndex}: Unexpected message "${message}". Expected pattern: ${expectedPattern}`,
                    ),
                );
            }
        } catch (error) {
            rejectors[dialogIndex]?.(
                error instanceof Error ? error : new Error(String(error)),
            );
        }
    };

    page.on("dialog", handler);

    try {
        await triggerAction();
        await Promise.all(dialogPromises);
    } finally {
        page.removeListener("dialog", handler);
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

export async function waitForBackendOperation(
    page: Page,
    options: {
        timeout?: number;
    } = {},
): Promise<void> {
    const { timeout = 5000 } = options;

    await page.waitForLoadState("networkidle", { timeout });
    await page.waitForTimeout(100);
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

    await page.waitForFunction(
        ({ sel, expected }) => {
            const element = document.querySelector(sel);
            if (!element) return false;
            const text = element.textContent || "";
            return typeof expected === "string"
                ? text.includes(expected)
                : new RegExp(expected).test(text);
        },
        { sel: selector, expected: expectedText.toString() },
        { timeout },
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
