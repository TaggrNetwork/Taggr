import { Browser, Page } from "@playwright/test";
import { Context } from "vm";

export async function performInNewContext<T>(
  browser: Browser,
  task: (page: Page) => Promise<T>
): Promise<[Context, T]> {
  const context = await browser.newContext();
  const page = await context.newPage();

  return [context, await task(page)];
}
