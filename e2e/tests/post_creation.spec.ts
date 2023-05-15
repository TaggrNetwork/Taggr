import { expect, test } from "@playwright/test";
import {
  createPost,
  createPostWithHashTag,
  createSeedPhraseUser,
  generateHashTag,
  performInNewContext,
} from "../support";
import { HomePage, FeedPage } from "../pages";

test("post creation", async ({ page, baseURL, browser }) => {
  const [postOneContent, postTwoContent] = await Promise.all([
    performInNewContext(browser, async (page) => {
      await createSeedPhraseUser(page, baseURL);

      return await createPost(page);
    }),

    performInNewContext(browser, async (page) => {
      await createSeedPhraseUser(page, baseURL);

      return await createPost(page);
    }),
  ]);

  const homePage = new HomePage(page);
  await homePage.goto();
  await homePage.showNewPosts();

  const postOne = await homePage.getPostByContent(postOneContent);
  await expect(postOne).toBeVisible();

  const postTwo = await homePage.getPostByContent(postTwoContent);
  await expect(postTwo).toBeVisible();
});

test("post creation with hashtag", async ({ page, baseURL, browser }) => {
  const hashTag = generateHashTag();

  const [postOneContent, postTwoContent] = await Promise.all([
    performInNewContext(browser, async (page) => {
      await createSeedPhraseUser(page, baseURL);

      return await createPostWithHashTag(page, hashTag);
    }),

    performInNewContext(browser, async (page) => {
      await createSeedPhraseUser(page, baseURL);

      return await createPostWithHashTag(page, hashTag);
    }),
  ]);

  const feedPage = new FeedPage(page);
  await feedPage.goto(hashTag);

  const postOne = await feedPage.getPostByContent(postOneContent);
  await expect(postOne).toBeVisible();

  const postTwo = await feedPage.getPostByContent(postTwoContent);
  await expect(postTwo).toBeVisible();
});
