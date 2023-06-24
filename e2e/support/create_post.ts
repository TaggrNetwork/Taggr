import { Page, expect } from "@playwright/test";
import { GlobalNavigationElement } from "../elements";
import { NewPostPage, RealmPage } from "../pages";
import { generateHashTag, generateText } from "./random_data";
import { CommonUser } from "./create_user";

export async function initPost(
  page: Page,
  user: CommonUser
): Promise<NewPostPage> {
  const globalNavigation = new GlobalNavigationElement(page, user);
  await globalNavigation.goToHomePage();
  const newPostPage = await globalNavigation.goToNewPostPage();
  await expect(newPostPage.editor.cycleCost).toHaveText("2");

  const postTextContent = generateText();
  await newPostPage.editor.addText(postTextContent);
  await expect(newPostPage.editor.cycleCost).toHaveText("2");

  return newPostPage;
}

export async function createPost(
  page: Page,
  user: CommonUser
): Promise<string> {
  const newPostPage = await initPost(page, user);
  const postTextContent = await newPostPage.editor.getContent();
  await newPostPage.submit();

  return postTextContent;
}

export async function createRealmPost(
  page: Page,
  user: CommonUser
): Promise<string> {
  const globalNavigation = new GlobalNavigationElement(page, user);
  const newPostPage = await globalNavigation.goToNewPostPage();
  const postTextContent = generateText();
  await newPostPage.editor.addText(postTextContent);
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
  await newPostPage.editor.addText(hashTagContent);
  await expect(newPostPage.editor.cycleCost).toHaveText("3");

  const postTextContent = await newPostPage.editor.getContent();
  await newPostPage.submit();

  return postTextContent;
}
