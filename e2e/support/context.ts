import { Browser, Page } from "@playwright/test";

export async function performInNewContext<T>(
  browser: Browser,
  task: (page: Page) => Promise<T>
): Promise<T> {
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    return await task(page);
  } finally {
    context.close();
  }
}
