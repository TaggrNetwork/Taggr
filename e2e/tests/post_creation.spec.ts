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
import { GlobalNavigationElement } from "../elements";
import { HomePage, FeedPage } from "../pages";

test("post creation", async ({ page, browser }) => {
  const [[postOneContext, postOneContent], [postTwoContext, postTwoContent]] =
    await Promise.all([
      performInNewContext(browser, async (page) => {
        const user = await createSeedPhraseUser(page);
        const globalNavigation = new GlobalNavigationElement(page, user);

        const profilePage = await globalNavigation.goToProfilePage();
        const cyclesBalance = await profilePage.getCyclesBalance();
        expect(cyclesBalance).toEqual(1000);

        const postContent = await createPost(page, user);

        await globalNavigation.goToProfilePage();

        const updatedCyclesBalance = await profilePage.getCyclesBalance();
        expect(updatedCyclesBalance).toEqual(cyclesBalance - 2);

        const postCount = await profilePage.getPostCount();
        expect(postCount).toEqual(1);

        const post = await profilePage.getPostByContent(postContent);
        await expect(post.element).toBeVisible();

        return postContent;
      }),

      performInNewContext(browser, async (page) => {
        const user = await createSeedPhraseUser(page);
        const globalNavigation = new GlobalNavigationElement(page, user);

        const profilePage = await globalNavigation.goToProfilePage();
        const cyclesBalance = await profilePage.getCyclesBalance();
        expect(cyclesBalance).toEqual(1000);

        const postContent = await createPost(page, user);

        await globalNavigation.goToProfilePage();

        const updatedCyclesBalance = await profilePage.getCyclesBalance();
        expect(updatedCyclesBalance).toEqual(cyclesBalance - 2);

        const postCount = await profilePage.getPostCount();
        expect(postCount).toEqual(1);

        const post = await profilePage.getPostByContent(postContent);
        await expect(post.element).toBeVisible();

        return postContent;
      }),
    ]);

  const homePage = new HomePage(page);
  await homePage.goto();
  await homePage.showNewPosts();

  const postOne = await homePage.getPostByContent(postOneContent);
  await expect(postOne.element).toBeVisible();

  const postTwo = await homePage.getPostByContent(postTwoContent);
  await expect(postTwo.element).toBeVisible();

  await postOneContext.close();
  await postTwoContext.close();
});

test("post creation with hashtag", async ({ page, browser }) => {
  const hashTag = generateHashTag();

  const [[postOneContext, postOneContent], [postTwoContext, postTwoContent]] =
    await Promise.all([
      performInNewContext(browser, async (page) => {
        const user = await createSeedPhraseUser(page);
        const globalNavigation = new GlobalNavigationElement(page, user);

        const profilePage = await globalNavigation.goToProfilePage();
        const cyclesBalance = await profilePage.getCyclesBalance();
        expect(cyclesBalance).toEqual(1000);

        const postContent = await createPostWithHashTag(page, user, hashTag);

        await globalNavigation.goToProfilePage();

        const updatedCyclesBalance = await profilePage.getCyclesBalance();
        expect(updatedCyclesBalance).toEqual(cyclesBalance - 3);

        const postCount = await profilePage.getPostCount();
        expect(postCount).toEqual(1);

        const post = await profilePage.getPostByContent(postContent);
        await expect(post.element).toBeVisible();

        return postContent;
      }),

      performInNewContext(browser, async (page) => {
        const user = await createSeedPhraseUser(page);
        const globalNavigation = new GlobalNavigationElement(page, user);

        const profilePage = await globalNavigation.goToProfilePage();
        const cyclesBalance = await profilePage.getCyclesBalance();
        expect(cyclesBalance).toEqual(1000);

        const postContent = await createPostWithHashTag(page, user, hashTag);

        await globalNavigation.goToProfilePage();

        const updatedCyclesBalance = await profilePage.getCyclesBalance();
        expect(updatedCyclesBalance).toEqual(cyclesBalance - 3);

        const postCount = await profilePage.getPostCount();
        expect(postCount).toEqual(1);

        const post = await profilePage.getPostByContent(postContent);
        await expect(post.element).toBeVisible();

        return postContent;
      }),
    ]);

  const feedPage = new FeedPage(page);
  await feedPage.goto(hashTag);

  const postOne = await feedPage.getPostByContent(postOneContent);
  await expect(postOne).toBeVisible();

  const postTwo = await feedPage.getPostByContent(postTwoContent);
  await expect(postTwo).toBeVisible();

  await postOneContext.close();
  await postTwoContext.close();
});

test("post creation with image", async ({ page }) => {
  const user = await createSeedPhraseUser(page);
  const globalNavigation = new GlobalNavigationElement(page, user);

  const profilePage = await globalNavigation.goToProfilePage();
  const cyclesBalance = await profilePage.getCyclesBalance();
  expect(cyclesBalance).toEqual(1000);

  const imagePath = resolve(__dirname, "..", "assets", "smash.jpg");
  const newPostPage = await initPost(page, user);
  await newPostPage.editor.addImage(imagePath);
  await expect(newPostPage.editor.cycleCost).toHaveText("12");

  const postContent = await newPostPage.editor.getContent();
  const postPage = await newPostPage.submit();
  const uploadedImage = postPage.postBody.locator("img");
  await expect(uploadedImage).toBeVisible();

  await expect(postPage.imagePreview).not.toBeVisible();

  await uploadedImage.click();
  await expect(postPage.imagePreview).toBeVisible();
  await expect(postPage.imagePreview.locator("img")).toHaveScreenshot();

  await postPage.imagePreview.click();
  await expect(postPage.imagePreview).not.toBeVisible();

  await globalNavigation.goToProfilePage();

  const updatedCyclesBalance = await profilePage.getCyclesBalance();
  expect(updatedCyclesBalance).toEqual(cyclesBalance - 12);

  const postCount = await profilePage.getPostCount();
  expect(postCount).toEqual(1);

  const post = await profilePage.getPostByContent(postContent);
  await expect(post.element).toBeVisible();
});
