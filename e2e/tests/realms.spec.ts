import { BrowserContext, expect, test } from "@playwright/test";
import {
  createPost,
  createRealmPost,
  createSeedPhraseUser,
  performInNewContext,
} from "../support";
import { GlobalNavigationElement } from "../elements";

test("realms", async ({ page, browser }) => {
  test.setTimeout(60000);

  const user = await test.step("create user", async () => {
    return await createSeedPhraseUser(page);
  });
  const globalNavigation = new GlobalNavigationElement(page, user);

  await test.step("check realms button is not visible", async () => {
    await expect(globalNavigation.toggleRealmsButton).not.toBeVisible();
  });

  await test.step("check initial cycles and new karma", async () => {
    const profilePage = await globalNavigation.goToProfilePage();

    const cyclesBalance = await profilePage.getCyclesBalance();
    expect(cyclesBalance).toEqual(1000);

    return cyclesBalance;
  });

  const realmPage = await test.step("create realm", async () => {
    const realmListPage = await globalNavigation.goToRealmsPage();
    const newRealmPage = await realmListPage.createNewRealm();

    const [realmPage] = await newRealmPage.fillAndSaveRealmForm();
    await expect(globalNavigation.toggleRealmsButton).toBeVisible();

    return realmPage;
  });

  await test.step("join and leave realm", async () => {
    await realmPage.burgerButton.click();
    await expect(realmPage.leaveRealmButton).toBeVisible();
    await realmPage.leaveRealm();
    await expect(realmPage.joinRealmButton).toBeVisible();
    await realmPage.joinRealm();
  });

  await test.step("check cycles after realm creation", async () => {
    const profilePage = await globalNavigation.goToProfilePage();
    const updatedCyclesBalance = await profilePage.getCyclesBalance();
    expect(updatedCyclesBalance).toEqual(0);
  });

  const realmName = realmPage.realmName;

  const [
    [postOneContext, postOneContent],
    [postTwoContext, postTwoContent],
    [postThreeContext, postThreeContent],
  ] = await test.step("create posts in realm", async () => {
    function createUserAndPostInRealm(): Promise<[BrowserContext, string]> {
      return performInNewContext(browser, async (page) => {
        const user = await createSeedPhraseUser(page);
        const globalNavigation = new GlobalNavigationElement(page, user);
        await expect(globalNavigation.toggleRealmsButton).not.toBeVisible();

        const realmListPage = await globalNavigation.goToRealmsPage();
        const realmPage = await realmListPage.goToRealm(realmName);

        await realmPage.burgerButton.click();
        await expect(realmPage.joinRealmButton).toBeVisible();
        await realmPage.joinRealm();
        await page.reload();
        await expect(globalNavigation.toggleRealmsButton).toBeVisible();

        await globalNavigation.enterRealm(realmName);
        return await createRealmPost(page, user);
      });
    }

    return await Promise.all([
      createUserAndPostInRealm(),
      createUserAndPostInRealm(),
      performInNewContext(browser, async (page) => {
        const user = await createSeedPhraseUser(page);

        return await createPost(page, user);
      }),
    ]);
  });

  await test.step("check that posts are displayed in realm", async () => {
    const homePage = await globalNavigation.enterRealm(realmName);
    await homePage.showNewPosts();

    const postOne = await homePage.getPostByContent(postOneContent);
    await expect(postOne.element).toBeVisible();

    const postTwo = await homePage.getPostByContent(postTwoContent);
    await expect(postTwo.element).toBeVisible();

    const postThree = await homePage.getPostByContent(postThreeContent);
    await expect(postThree.element).not.toBeVisible();
  });

  await postOneContext.close();
  await postTwoContext.close();
  await postThreeContext.close();
});
