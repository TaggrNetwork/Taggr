import { BrowserContext, expect, test } from "@playwright/test";
import {
  createPost,
  createSeedPhraseUser,
  performInNewContext,
} from "../support";
import { GlobalNavigationElement } from "../elements";

test("bookmarks", async ({ page, browser }) => {
  test.setTimeout(40000);

  function createUserAndPostInRealm(): Promise<[BrowserContext, string]> {
    return performInNewContext(browser, async (page) => {
      const user = await createSeedPhraseUser(page);
      return await createPost(page, user);
    });
  }

  const [
    [postOneContext, postOneContent],
    [postTwoContext, postTwoContent],
    [postThreeContext, postThreeContent],
  ] = await Promise.all([
    createUserAndPostInRealm(),
    createUserAndPostInRealm(),
    createUserAndPostInRealm(),
  ]);

  const user = await createSeedPhraseUser(page);
  const globalNavigation = new GlobalNavigationElement(page, user);
  const homePage = await globalNavigation.goToHomePage();
  await homePage.goto();
  await homePage.showNewPosts();

  const postOne = await homePage.getPostByContent(postOneContent);
  await expect(postOne.element).toBeVisible();
  await postOne.toggleBookmark();

  const postTwo = await homePage.getPostByContent(postTwoContent);
  await expect(postTwo.element).toBeVisible();
  await postTwo.toggleBookmark();

  const postThree = await homePage.getPostByContent(postThreeContent);
  await expect(postThree.element).toBeVisible();
  await postThree.toggleBookmark();

  const bookmarksPage = await globalNavigation.goToBookmarksPage();

  const bookmarkedPostOne = await bookmarksPage.getPostByContent(
    postOneContent
  );
  await expect(bookmarkedPostOne.element).toBeVisible();

  const bookmarkedPostTwo = await bookmarksPage.getPostByContent(
    postTwoContent
  );
  await expect(bookmarkedPostTwo.element).toBeVisible();

  const bookmarkedPostThree = await bookmarksPage.getPostByContent(
    postThreeContent
  );
  await expect(bookmarkedPostThree.element).toBeVisible();

  await bookmarkedPostTwo.toggleBookmark();
  await page.reload();
  await expect(bookmarkedPostOne.element).toBeVisible();
  await expect(bookmarkedPostTwo.element).not.toBeVisible();
  await expect(bookmarkedPostThree.element).toBeVisible();

  await postOneContext.close();
  await postTwoContext.close();
  await postThreeContext.close();
});
