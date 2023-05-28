import { Locator, Page } from "@playwright/test";

export function getPostHeartReaction(post: Locator): Locator {
  return post.getByTestId("heart-reaction");
}

async function givePostReaction(
  page: Page,
  post: Locator,
  reaction: string
): Promise<void> {
  const postInfoToggleButton = post.getByTestId("post-info-toggle");
  await postInfoToggleButton.click();

  const heartReactionButton = post.getByTestId(`give-${reaction}-reaction`);
  await heartReactionButton.click();

  // wait 4 seconds for the reaction "grace period"
  await page.waitForTimeout(4000);
  // wait for the update and read_state calls to complete
  await page.waitForResponse("**/query", { timeout: 6000 });
}

export async function givePostHeartReaction(
  page: Page,
  post: Locator
): Promise<void> {
  return await givePostReaction(page, post, "heart");
}
