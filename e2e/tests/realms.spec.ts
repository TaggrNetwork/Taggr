import { BrowserContext, expect, test } from "@playwright/test";
import {
  createPost,
  createSeedPhraseUser,
  performInNewContext,
} from "../support";
import { GlobalNavigationElement } from "../elements";

test("realms", async ({ page, browser }) => {
  test.setTimeout(60000);

  const user = await createSeedPhraseUser(page);
  const globalNavigation = new GlobalNavigationElement(page, user);
  await expect(globalNavigation.toggleRealmsButton).not.toBeVisible();

  const profilePage = await globalNavigation.goToProfilePage();
  const cyclesBalance = await profilePage.getCyclesBalance();
  expect(cyclesBalance).toEqual(1000);

  const realmListPage = await globalNavigation.goToRealmsPage();
  const newRealmPage = await realmListPage.createNewRealm();
  const realmPage = await newRealmPage.fillAndSaveRealmForm();

  await expect(globalNavigation.toggleRealmsButton).toBeVisible();
  await expect(realmPage.leaveRealmButton).toBeVisible();
  await realmPage.leaveRealm();
  await expect(realmPage.joinRealmButton).toBeVisible();
  await realmPage.joinRealm();

  await globalNavigation.goToProfilePage();
  const updatedCyclesBalance = await profilePage.getCyclesBalance();
  expect(updatedCyclesBalance).toEqual(0);

  const realmName = realmPage.realmName;

  function createUserAndPostInRealm(): Promise<[BrowserContext, string]> {
    return performInNewContext(browser, async (page) => {
      const user = await createSeedPhraseUser(page);
      const globalNavigation = new GlobalNavigationElement(page, user);
      await expect(globalNavigation.toggleRealmsButton).not.toBeVisible();

      const realmListPage = await globalNavigation.goToRealmsPage();
      const realmPage = await realmListPage.goToRealm(realmName);

      await expect(realmPage.joinRealmButton).toBeVisible();
      await realmPage.joinRealm();
      await page.reload();
      await expect(globalNavigation.toggleRealmsButton).toBeVisible();

      await globalNavigation.enterRealm(realmName);
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
    performInNewContext(browser, async (page) => {
      const user = await createSeedPhraseUser(page);

      return await createPost(page, user);
    }),
  ]);

  await globalNavigation.enterRealm(realmName);
  const homePage = await globalNavigation.goToHomePage();
  await homePage.showNewPosts();

  const postOne = await homePage.getPostByContent(postOneContent);
  await expect(postOne.element).toBeVisible();

  const postTwo = await homePage.getPostByContent(postTwoContent);
  await expect(postTwo.element).toBeVisible();

  const postThree = await homePage.getPostByContent(postThreeContent);
  await expect(postThree.element).not.toBeVisible();

  await postOneContext.close();
  await postTwoContext.close();
  await postThreeContext.close();
});
