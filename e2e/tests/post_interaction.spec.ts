import { expect, test } from "@playwright/test";
import {
  createPost,
  createSeedPhraseUser,
  getPostHeartReaction,
  givePostHeartReaction,
  performInNewContext,
} from "../support";
import { GlobalNavigation } from "../pages";

test("love heart a post", async ({ page, browser }) => {
  test.setTimeout(35000);

  const user = await createSeedPhraseUser(page);
  const globalNavigation = new GlobalNavigation(page, user);

  const profilePage = await globalNavigation.goToProfilePage();

  const cyclesBalance = await profilePage.getCyclesBalance();
  expect(cyclesBalance).toEqual(1000);

  const newKarmaBalance = await profilePage.getNewKarmaBalance();
  expect(newKarmaBalance).toEqual(0);

  const postContent = await createPost(page, user);

  await globalNavigation.goToProfilePage();

  const updatedCyclesBalance = await profilePage.getCyclesBalance();
  expect(updatedCyclesBalance).toEqual(cyclesBalance - 2);

  const postCount = await profilePage.getPostCount();
  expect(postCount).toEqual(1);

  const post = await profilePage.getPostByContent(postContent);
  await expect(post).toBeVisible();

  const [postReactionContext] = await performInNewContext(
    browser,
    async (page) => {
      const user = await createSeedPhraseUser(page);
      const globalNavigation = new GlobalNavigation(page, user);

      const profilePage = await globalNavigation.goToProfilePage();
      const cyclesBalance = await profilePage.getCyclesBalance();
      expect(cyclesBalance).toEqual(1000);

      const homePage = await globalNavigation.goToHomePage();
      await homePage.showNewPosts();

      const post = await homePage.getPostByContent(postContent);
      await givePostHeartReaction(page, post);

      const heartReaction = getPostHeartReaction(post);
      expect(heartReaction).toBeVisible();

      await globalNavigation.goToProfilePage();
      await page.reload();
      const updatedCyclesBalance = await profilePage.getCyclesBalance();
      expect(updatedCyclesBalance).toEqual(cyclesBalance - 2);
    }
  );

  await page.reload();

  const updatedKarmaBalance = await profilePage.getNewKarmaBalance();
  expect(updatedKarmaBalance).toEqual(0);

  const heartReaction = getPostHeartReaction(post);
  expect(heartReaction).toBeVisible();

  await postReactionContext.close();
});
