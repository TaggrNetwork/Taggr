import { expect, test } from "@playwright/test";
import {
  createPost,
  createSeedPhraseUser,
  performInNewContext,
} from "../support";
import { GlobalNavigationElement } from "../elements";

test("love heart a post", async ({ page, browser }) => {
  test.setTimeout(35000);

  const user = await createSeedPhraseUser(page);
  const globalNavigation = new GlobalNavigationElement(page, user);

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
  await expect(post.element).toBeVisible();

  const [postReactionContext] = await performInNewContext(
    browser,
    async (page) => {
      const user = await createSeedPhraseUser(page);
      const globalNavigation = new GlobalNavigationElement(page, user);

      const profilePage = await globalNavigation.goToProfilePage();
      const cyclesBalance = await profilePage.getCyclesBalance();
      expect(cyclesBalance).toEqual(1000);

      const homePage = await globalNavigation.goToHomePage();
      await homePage.showNewPosts();

      const post = await homePage.getPostByContent(postContent);
      await post.giveHeartReaction();

      const heartReaction = post.getHeartReaction();
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

  const heartReaction = post.getHeartReaction();
  expect(heartReaction).toBeVisible();

  await postReactionContext.close();
});

test("react with fire and comment on a post", async ({ page, browser }) => {
  test.setTimeout(35000);

  const user = await createSeedPhraseUser(page);
  const globalNavigation = new GlobalNavigationElement(page, user);

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
  await expect(post.element).toBeVisible();

  const [postReactionContext, commentContent] = await performInNewContext(
    browser,
    async (page) => {
      const user = await createSeedPhraseUser(page);
      const globalNavigation = new GlobalNavigationElement(page, user);

      const profilePage = await globalNavigation.goToProfilePage();
      const originalCyclesBalance = await profilePage.getCyclesBalance();
      expect(originalCyclesBalance).toEqual(1000);

      const homePage = await globalNavigation.goToHomePage();
      await homePage.showNewPosts();

      const post = await homePage.getPostByContent(postContent);
      await post.giveFireReaction();

      const fireReaction = post.getFireReaction();
      expect(fireReaction).toBeVisible();

      const commentContent = await post.giveComment();
      const comment = post.getCommentByContent(commentContent);
      expect(comment.element).toBeVisible();

      await globalNavigation.goToProfilePage();
      await page.reload();
      const cyclesBalanceAfterReaction = await profilePage.getCyclesBalance();
      expect(cyclesBalanceAfterReaction).toEqual(originalCyclesBalance - 8);

      return commentContent;
    }
  );

  await page.reload();

  const updatedKarmaBalance = await profilePage.getNewKarmaBalance();
  expect(updatedKarmaBalance).toEqual(0);

  const fireReaction = post.getFireReaction();
  expect(fireReaction).toBeVisible();

  await post.toggleComments();
  const comment = post.getCommentByContent(commentContent);
  await expect(comment.element).toBeVisible();

  await postReactionContext.close();
});
