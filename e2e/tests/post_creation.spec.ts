import { BrowserContext, expect, test } from "@playwright/test";
import { resolve } from "node:path";
import {
    createPost,
    createPostWithHashTag,
    createSeedPhraseUser,
    generateHashTag,
    generateRandomWord,
    initPost,
    performInNewContext,
} from "../support";
import { GlobalNavigationElement } from "../elements";
import { HomePage, FeedPage } from "../pages";

test("post creation", async ({ page, browser }) => {
    const [
        [postOneContext, postOneContent],
        [postTwoContext, postTwoContent],
        [postThreeContext, postThreeContent],
    ] = await test.step("create posts", async () => {
        function createUserAndPost(): Promise<[BrowserContext, string]> {
            return performInNewContext(browser, async (page) => {
                const user = await createSeedPhraseUser(page);
                const globalNavigation = new GlobalNavigationElement(
                    page,
                    user,
                );

                const profilePage = await globalNavigation.goToProfilePage();
                const cyclesBalance = await profilePage.getCyclesBalance();
                expect(cyclesBalance).toEqual(1000);

                const postContent = await createPost(page, user);

                await globalNavigation.goToProfilePage();

                const updatedCyclesBalance =
                    await profilePage.getCyclesBalance();
                expect(updatedCyclesBalance).toEqual(cyclesBalance - 2);

                const postCount = await profilePage.getPostCount();
                expect(postCount).toEqual(1);

                const post = await profilePage.getPostByContent(postContent);
                await expect(post.element).toBeVisible();

                return postContent;
            });
        }

        return await Promise.all([
            createUserAndPost(),
            createUserAndPost(),
            createUserAndPost(),
        ]);
    });

    await test.step("find created posts on home page", async () => {
        const homePage = new HomePage(page);
        await homePage.goto();
        await homePage.showNewPosts();

        const postOne = await homePage.getPostByContent(postOneContent);
        await expect(postOne.element).toBeVisible();

        const postTwo = await homePage.getPostByContent(postTwoContent);
        await expect(postTwo.element).toBeVisible();

        const postThree = await homePage.getPostByContent(postThreeContent);
        await expect(postThree.element).toBeVisible();
    });

    await postOneContext.close();
    await postTwoContext.close();
    await postThreeContext.close();
});

test("post creation with hashtag", async ({ page, browser }) => {
    const hashTag = generateHashTag();

    const [
        [postOneContext, postOneContent],
        [postTwoContext, postTwoContent],
        [postThreeContext, postThreeContent],
    ] = await test.step("create posts", async () => {
        function createUserAndPost(): Promise<[BrowserContext, string]> {
            return performInNewContext(browser, async (page) => {
                const user = await createSeedPhraseUser(page);
                const globalNavigation = new GlobalNavigationElement(
                    page,
                    user,
                );

                const profilePage = await globalNavigation.goToProfilePage();
                const cyclesBalance = await profilePage.getCyclesBalance();
                expect(cyclesBalance).toEqual(1000);

                const postContent = await createPostWithHashTag(
                    page,
                    user,
                    hashTag,
                );

                await globalNavigation.goToProfilePage();

                const updatedCyclesBalance =
                    await profilePage.getCyclesBalance();
                expect(updatedCyclesBalance).toEqual(cyclesBalance - 3);

                const postCount = await profilePage.getPostCount();
                expect(postCount).toEqual(1);

                const post = await profilePage.getPostByContent(postContent);
                await expect(post.element).toBeVisible();

                return postContent;
            });
        }

        return await Promise.all([
            createUserAndPost(),
            createUserAndPost(),
            createUserAndPost(),
        ]);
    });

    await test.step("find created posts on feed page", async () => {
        const feedPage = new FeedPage(page);
        await feedPage.goto(hashTag);

        const postOne = await feedPage.getPostByContent(postOneContent);
        await expect(postOne.element).toBeVisible();

        const postTwo = await feedPage.getPostByContent(postTwoContent);
        await expect(postTwo.element).toBeVisible();

        const postThree = await feedPage.getPostByContent(postThreeContent);
        await expect(postThree.element).toBeVisible();
    });

    await postOneContext.close();
    await postTwoContext.close();
    await postThreeContext.close();
});

test("post creation with image", async ({ page }) => {
    const user = await test.step("create user", async () => {
        return await createSeedPhraseUser(page);
    });
    const globalNavigation = new GlobalNavigationElement(page, user);

    const cyclesBalance =
        await test.step("check initial cycles on profile page", async () => {
            const profilePage = await globalNavigation.goToProfilePage();
            const cyclesBalance = await profilePage.getCyclesBalance();
            expect(cyclesBalance).toEqual(1000);

            return cyclesBalance;
        });

    const [postContent, postPage] =
        await test.step("create post with image", async () => {
            const imagePath = resolve(__dirname, "..", "assets", "smash.jpg");
            const newPostPage = await initPost(page, user);
            await newPostPage.editor.addImage(imagePath);
            await expect(newPostPage.editor.cycleCost).toHaveText("12");

            const postContent = await newPostPage.editor.getContent();
            const postPage = await newPostPage.submit();

            return [postContent, postPage];
        });

    await test.step("check uploaded image", async () => {
        const uploadedImage = postPage.postBody.locator("img");
        await expect(uploadedImage).toBeVisible();

        await expect(postPage.imagePreview).not.toBeVisible();

        await uploadedImage.click();
        await expect(postPage.imagePreview).toBeVisible();
        await expect(postPage.imagePreview.locator("img")).toHaveScreenshot();

        await postPage.imagePreview.click();
        await expect(postPage.imagePreview).not.toBeVisible();
    });

    await test.step("check updated cycles and post on profile page", async () => {
        const profilePage = await globalNavigation.goToProfilePage();
        const updatedCyclesBalance = await profilePage.getCyclesBalance();
        expect(updatedCyclesBalance).toEqual(cyclesBalance - 12);

        const postCount = await profilePage.getPostCount();
        expect(postCount).toEqual(1);

        const post = await profilePage.getPostByContent(postContent);
        await expect(post.element).toBeVisible();
    });
});

test("journal", async ({ page }) => {
    const user = await createSeedPhraseUser(page);
    const globalNavigation = new GlobalNavigationElement(page, user);

    const [postOneContent, postTwoContent, postThreeContent] =
        await test.step("create posts", async () => {
            const profilePage = await globalNavigation.goToProfilePage();
            const cyclesBalance = await profilePage.getCyclesBalance();
            expect(cyclesBalance).toEqual(1000);

            const postOneContent = await createPost(page, user);
            const postTwoContent = await createPost(page, user);
            const postThreeContent = await createPost(page, user);

            await globalNavigation.goToProfilePage();

            const updatedCyclesBalance = await profilePage.getCyclesBalance();
            expect(updatedCyclesBalance).toEqual(cyclesBalance - 6);

            return [postOneContent, postTwoContent, postThreeContent];
        });

    await test.step("find created posts in journal", async () => {
        const journalPage = await globalNavigation.goToJournalPage();

        const postOne = await journalPage.getPostByContent(postOneContent);
        await expect(postOne.element).toBeVisible();

        const postTwo = await journalPage.getPostByContent(postTwoContent);
        await expect(postTwo.element).toBeVisible();

        const postThree = await journalPage.getPostByContent(postThreeContent);
        await expect(postThree.element).toBeVisible();
    });
});

test("post creation with a poll", async ({ page }) => {
    const user = await test.step("create user", async () => {
        return await createSeedPhraseUser(page);
    });

    await test.step("create post with a poll", async () => {
        const newPostPage = await initPost(page, user);
        await newPostPage.editor.addText(
            "Post with poll " + generateRandomWord(),
        );
        await newPostPage.editor.createPoll("Red pill\nBlue pill");

        await newPostPage.submit();

        const postText = page.getByText("Post with poll");
        await expect(postText).toBeVisible();
        const bluePillOption = page.getByText("Blue pill");
        await expect(bluePillOption).toBeVisible();
        const redPillOption = page.getByText("Red pill");
        await expect(redPillOption).toBeVisible();
    });
});
