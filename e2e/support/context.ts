import { Browser, BrowserContext, Page } from "@playwright/test";
import { HomePage } from "../pages";

export async function performInNewContext<T>(
    browser: Browser,
    task: (page: Page) => Promise<T>,
): Promise<[BrowserContext, T]> {
    const context = await browser.newContext();
    const page = await context.newPage();

    return [context, await task(page)];
}

export async function performInExistingContext<T>(
    context: BrowserContext,
    task: (page: Page) => Promise<T>,
): Promise<T> {
    const page = await context.newPage();
    // if we don't go to a URL, then the page will be blank
    new HomePage(page).goto();

    return await task(page);
}
