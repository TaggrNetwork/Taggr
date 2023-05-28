import { Page, expect } from "@playwright/test";
import { GlobalNavigation, NewPostPage } from "../pages";
import { generateHashTag, generateText } from "./random_data";
import { CommonUser } from "./create_user";

export async function initPost(
  page: Page,
  user: CommonUser
): Promise<NewPostPage> {
  const globalNavigation = new GlobalNavigation(page, user);
  const newPostPage = await globalNavigation.createNewPost();
  await expect(newPostPage.cycleCost).toHaveText("2");

  const postTextContent = generateText();
  await newPostPage.addPostTextContent(postTextContent);
  await expect(newPostPage.cycleCost).toHaveText("2");

  return newPostPage;
}

export async function createPost(
  page: Page,
  user: CommonUser
): Promise<string> {
  const newPostPage = await initPost(page, user);
  const postTextContent = await newPostPage.getPostContent();
  await newPostPage.submit();

  return postTextContent;
}

export async function createPostWithHashTag(
  page: Page,
  user: CommonUser,
  hashtag?: string
): Promise<string> {
  const newPostPage = await initPost(page, user);

  const hashTagContent = `\n#${hashtag || generateHashTag()}`;
  await newPostPage.addPostTextContent(hashTagContent);
  await expect(newPostPage.cycleCost).toHaveText("3");

  const postTextContent = await newPostPage.getPostContent();
  await newPostPage.submit();

  return postTextContent;
}
