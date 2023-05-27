import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import {
  createPost,
  createPostWithHashTag,
  createSeedPhraseUser,
  generateHashTag,
  initPost,
  performInNewContext,
} from "../support";
import { HomePage, FeedPage } from "../pages";

test("post creation", async ({ page, browser }) => {
  const [postOneContent, postTwoContent] = await Promise.all([
    performInNewContext(browser, async (page) => {
      await createSeedPhraseUser(page);

      return await createPost(page);
    }),

    performInNewContext(browser, async (page) => {
      await createSeedPhraseUser(page);

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

test("post creation with hashtag", async ({ page, browser }) => {
  const hashTag = generateHashTag();

  const [postOneContent, postTwoContent] = await Promise.all([
    performInNewContext(browser, async (page) => {
      await createSeedPhraseUser(page);

      return await createPostWithHashTag(page, hashTag);
    }),

    performInNewContext(browser, async (page) => {
      await createSeedPhraseUser(page);

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

test("post creation with image", async ({ page }) => {
  await createSeedPhraseUser(page);

  const imagePath = resolve(__dirname, "..", "assets", "smash.jpg");
  const newPostPage = await initPost(page);
  await newPostPage.addImage(imagePath);
  await expect(newPostPage.cycleCost).toHaveText("12");

  const postPage = await newPostPage.submit();
  const uploadedImage = postPage.postBody.locator("img");
  await expect(uploadedImage).toBeVisible();

  await expect(postPage.imagePreview).not.toBeVisible();

  await uploadedImage.click();
  await expect(postPage.imagePreview).toBeVisible();
  await expect(postPage.imagePreview.locator("img")).toHaveScreenshot();

  await postPage.imagePreview.click();
  await expect(postPage.imagePreview).not.toBeVisible();
});
