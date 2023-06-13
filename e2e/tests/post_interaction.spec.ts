import { expect, test } from "@playwright/test";
import {
  createPost,
  createSeedPhraseUser,
  performInNewContext,
} from "../support";
import { GlobalNavigationElement } from "../elements";

test("love heart a post", async ({ page, browser }) => {
  test.setTimeout(60000);

  const user = await test.step("create user", async () => {
    return await createSeedPhraseUser(page);
  });
  const globalNavigation = new GlobalNavigationElement(page, user);

  const cyclesBalance =
    await test.step("check initial cycles and new karma", async () => {
      const profilePage = await globalNavigation.goToProfilePage();

      const cyclesBalance = await profilePage.getCyclesBalance();
      expect(cyclesBalance).toEqual(1000);

      const newKarmaBalance = await profilePage.getNewKarmaBalance();
      expect(newKarmaBalance).toEqual(0);

      return cyclesBalance;
    });

  const postContent = await test.step("create post", async () => {
    return await createPost(page, user);
  });

  await test.step("check cycles and new karma after post creation", async () => {
    const profilePage = await globalNavigation.goToProfilePage();

    const updatedCyclesBalance = await profilePage.getCyclesBalance();
    expect(updatedCyclesBalance).toEqual(cyclesBalance - 2);

    const postCount = await profilePage.getPostCount();
    expect(postCount).toEqual(1);

    const post = await profilePage.getPostByContent(postContent);
    await expect(post.element).toBeVisible();
  });

  const [postReactionContext] =
    await test.step("create user and react to post", async () => {
      return await performInNewContext(browser, async (page) => {
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
      });
    });

  await test.step("check cycles and new karma after post reaction", async () => {
    const profilePage = await globalNavigation.goToProfilePage();
    await page.reload();
    const post = await profilePage.getPostByContent(postContent);

    const updatedKarmaBalance = await profilePage.getNewKarmaBalance();
    expect(updatedKarmaBalance).toEqual(0);

    const heartReaction = post.getHeartReaction();
    expect(heartReaction).toBeVisible();
  });

  await postReactionContext.close();
});

test("react with fire and comment on a post", async ({ page, browser }) => {
  test.setTimeout(60000);

  const user = await test.step("create user", async () => {
    return await createSeedPhraseUser(page);
  });
  const globalNavigation = new GlobalNavigationElement(page, user);

  const cyclesBalance =
    await test.step("check initial cycles and new karma", async () => {
      const profilePage = await globalNavigation.goToProfilePage();

      const cyclesBalance = await profilePage.getCyclesBalance();
      expect(cyclesBalance).toEqual(1000);

      const newKarmaBalance = await profilePage.getNewKarmaBalance();
      expect(newKarmaBalance).toEqual(0);

      return cyclesBalance;
    });

  const postContent = await test.step("create post", async () => {
    return await createPost(page, user);
  });

  await test.step("check cycles and new karma after post creation", async () => {
    const profilePage = await globalNavigation.goToProfilePage();

    const updatedCyclesBalance = await profilePage.getCyclesBalance();
    expect(updatedCyclesBalance).toEqual(cyclesBalance - 2);

    const postCount = await profilePage.getPostCount();
    expect(postCount).toEqual(1);

    const post = await profilePage.getPostByContent(postContent);
    await expect(post.element).toBeVisible();
  });

  const [postReactionContext, commentContent] =
    await test.step("create user then comment and react to post", async () => {
      return await performInNewContext(browser, async (page) => {
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
      });
    });

  await test.step("check cycles and new karma after post reaction", async () => {
    const profilePage = await globalNavigation.goToProfilePage();
    await page.reload();
    const post = await profilePage.getPostByContent(postContent);

    const updatedKarmaBalance = await profilePage.getNewKarmaBalance();
    expect(updatedKarmaBalance).toEqual(0);

    const fireReaction = post.getFireReaction();
    expect(fireReaction).toBeVisible();

    await post.toggleComments();
    const comment = post.getCommentByContent(commentContent);
    await expect(comment.element).toBeVisible();
  });

  await page.reload();

  await postReactionContext.close();
});
