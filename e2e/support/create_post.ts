import { Page, expect } from "@playwright/test";
import { HomePage, NewPostPage } from "../pages";
import { generateHashTag, generateText } from "./random_data";

export async function initPost(page: Page): Promise<NewPostPage> {
  const homePage = new HomePage(page);
  await homePage.goto();

  const newPostPage = await homePage.createPost();
  await expect(newPostPage.cycleCost).toHaveText("2");

  const postTextContent = generateText();
  await newPostPage.addPostTextContent(postTextContent);
  await expect(newPostPage.cycleCost).toHaveText("2");

  return newPostPage;
}

export async function createPost(page: Page): Promise<string> {
  const newPostPage = await initPost(page);
  const postTextContent = await newPostPage.getPostContent();
  await newPostPage.submit();

  return postTextContent;
}

export async function createPostWithHashTag(
  page: Page,
  hashtag?: string
): Promise<string> {
  const newPostPage = await initPost(page);

  const hashTagContent = `\n#${hashtag || generateHashTag()}`;
  await newPostPage.addPostTextContent(hashTagContent);
  await expect(newPostPage.cycleCost).toHaveText("3");

  const postTextContent = await newPostPage.getPostContent();
  await newPostPage.submit();

  return postTextContent;
}
