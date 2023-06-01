import { Browser, BrowserContext, Page } from "@playwright/test";

export async function performInNewContext<T>(
  browser: Browser,
  task: (page: Page) => Promise<T>
): Promise<[BrowserContext, T]> {
  const context = await browser.newContext();
  const page = await context.newPage();

  return [context, await task(page)];
}
