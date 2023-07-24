import { BrowserContext, expect, test } from "@playwright/test";
import {
    createPost,
    createSeedPhraseUser,
    performInNewContext,
} from "../support";
import { GlobalNavigationElement } from "../elements";

test("bookmarks", async ({ page, browser }) => {
    test.setTimeout(70000);

    const [
        [postOneContext, postOneContent],
        [postTwoContext, postTwoContent],
        [postThreeContext, postThreeContent],
    ] = await test.step("create posts", async () => {
        function createUserAndPost(): Promise<[BrowserContext, string]> {
            return performInNewContext(browser, async (page) => {
                const user = await createSeedPhraseUser(page);
                return await createPost(page, user);
            });
        }

        return await Promise.all([
            createUserAndPost(),
            createUserAndPost(),
            createUserAndPost(),
        ]);
    });

    const user = await test.step("create user", async () => {
        return await createSeedPhraseUser(page);
    });
    const globalNavigation = new GlobalNavigationElement(page, user);

    const homePage = await test.step("go to home page", async () => {
        const homePage = await globalNavigation.goToHomePage();
        await homePage.goto();
        await homePage.showNewPosts();

        return homePage;
    });

    await test.step("bookmark posts", async () => {
        async function bookmarkPost(postContent: string): Promise<void> {
            const post = await homePage.getPostByContent(postContent);
            await expect(post.element).toBeVisible();
            await post.toggleBookmark();
        }

        await bookmarkPost(postOneContent);
        await bookmarkPost(postTwoContent);
        await bookmarkPost(postThreeContent);
    });

    await test.step("find bookmarks on bookmarks page", async () => {
        const bookmarksPage = await globalNavigation.goToBookmarksPage();

        const bookmarkedPostOne = await bookmarksPage.getPostByContent(
            postOneContent,
        );
        await expect(bookmarkedPostOne.element).toBeVisible();

        const bookmarkedPostTwo = await bookmarksPage.getPostByContent(
            postTwoContent,
        );
        await expect(bookmarkedPostTwo.element).toBeVisible();

        const bookmarkedPostThree = await bookmarksPage.getPostByContent(
            postThreeContent,
        );
        await expect(bookmarkedPostThree.element).toBeVisible();

        await bookmarkedPostTwo.toggleBookmark();
        await page.reload({ waitUntil: "networkidle" });
        await expect(bookmarkedPostOne.element).toBeVisible();
        await expect(bookmarkedPostTwo.element).not.toBeVisible();
        await expect(bookmarkedPostThree.element).toBeVisible();
    });

    await postOneContext.close();
    await postTwoContext.close();
    await postThreeContext.close();
});
