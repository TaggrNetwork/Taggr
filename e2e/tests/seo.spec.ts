import http from "node:http";
import { expect, test } from "@playwright/test";
import {
    createPost,
    createSeedPhraseUser,
    performInNewContext,
    topUpCredits,
} from "../support";
import { GlobalNavigationElement } from "../elements";

const BASE_DOMAIN = "https://taggr.link";

// force URLs to be resolved on localhost
// this is required because we are using URLs in this form:
//   http://bw4dl-smaaa-aaaaa-qaacq-cai.localhost:8080/
// this is supported by browsers, but not by node.js
const agent = new http.Agent({
    lookup: (_hostname, _options, cb) => {
        cb(null, "127.0.0.1", 4);
    },
});

async function get(url: string): Promise<string> {
    return await new Promise((resolve) => {
        http.get(url, { agent }, (res) => {
            let data = "";

            res.on("data", (chunk) => {
                data += chunk;
            });

            res.on("end", () => {
                resolve(data);
            });
        });
    });
}

function escapeUrl(url: string): string {
    return url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function canonicalRegex(url: string): RegExp {
    let escapedUrl = escapeUrl(url);

    return new RegExp(
        `<link\\s*href="${escapedUrl}"\\s*rel="canonical"\\s*/>`,
        "i",
    );
}

function ogUrlRegex(url: string): RegExp {
    let escapedUrl = escapeUrl(url);

    return new RegExp(
        `<meta\\s*content="${escapedUrl}"\\s*property="og:url"\\s*/>`,
        "i",
    );
}

function titleRegex(title: string): RegExp {
    return new RegExp(`<title>${title}</title>`);
}

function ogTitleRegex(title: string): RegExp {
    return new RegExp(
        `<meta\\s*content="${title}"\\s*property="og:title"\\s*/>`,
    );
}

function twitterTitleRegex(title: string): RegExp {
    return new RegExp(
        `<meta\\s*content="${title}"\\s*property="twitter:title"\\s*/>`,
    );
}

function limitString(str: string): string {
    if (str.length > 160) {
        return `${str.slice(0, 157)}...`;
    } else {
        return str;
    }
}

function replaceNewLines(str: string): string {
    return str.replace(/\n/g, " ");
}

function prepareDescription(str: string): string {
    return replaceNewLines(limitString(str));
}

function descriptionRegex(description: string): RegExp {
    const seoDescription = prepareDescription(description);

    return new RegExp(
        `<meta\\s*content="${seoDescription}"\\s*name="description"\\s*/>`,
    );
}

function ogDescriptionRegex(description: string): RegExp {
    const seoDescription = prepareDescription(description);

    return new RegExp(
        `<meta\\s*content="${seoDescription}"\\s*property="og:description"\\s*/>`,
    );
}

function twitterDescriptionRegex(description: string): RegExp {
    const seoDescription = prepareDescription(description);

    return new RegExp(
        `<meta\\s*content="${seoDescription}"\\s*property="twitter:description"\\s*/>`,
    );
}

function ogTypeRegex(type: string): RegExp {
    return new RegExp(`<meta\\s*content="${type}"\\s*property="og:type"\\s*/>`);
}

function checkMetadata(
    html: string,
    url: string,
    title: string,
    description: string,
    type: string,
): void {
    expect(html).toMatch(canonicalRegex(url));
    expect(html).toMatch(ogUrlRegex(url));

    expect(html).toMatch(ogTitleRegex(title));
    expect(html).toMatch(titleRegex(title));
    expect(html).toMatch(twitterTitleRegex(title));

    expect(html).toMatch(descriptionRegex(description));
    expect(html).toMatch(ogDescriptionRegex(description));
    expect(html).toMatch(twitterDescriptionRegex(description));

    expect(html).toMatch(ogTypeRegex(type));
}

test("seo and metadata", async ({ page, baseURL, browser }) => {
    test.setTimeout(60000);

    const user = await test.step("create user", async () => {
        return await createSeedPhraseUser(page);
    });
    const globalNavigation = new GlobalNavigationElement(page, user);

    await test.step("check user profile metadata", async () => {
        const html = await get(`${baseURL}/user/${user.username}`);
        const url = `${BASE_DOMAIN}/#/user/${user.username}`;
        const title = `User @${user.username}`;

        checkMetadata(html, url, title, user.about, "profile");
    });

    await test.step("check user journal metadata", async () => {
        const html = await get(`${baseURL}/journal/${user.username}`);
        const url = `${BASE_DOMAIN}/#/journal/${user.username}`;
        const title = `@${user.username}'s journal`;

        checkMetadata(html, url, title, user.about, "website");
    });

    const [realmName, realmDescription] =
        await test.step("create realm", async () => {
            const realmListPage = await globalNavigation.goToRealmsPage();
            const newRealmPage = await realmListPage.createNewRealm();

            const [realmPage, realmName, realmDescription] =
                await newRealmPage.fillAndSaveRealmForm();
            await realmPage.closeButton.click();

            await topUpCredits(page, user);

            return [realmName, realmDescription];
        });

    await test.step("check realm metadata", async () => {
        const html = await get(`${baseURL}/realm/${realmName}`);
        const url = `${BASE_DOMAIN}/#/realm/${realmName}`;
        const title = `Realm ${realmName.toUpperCase()}`;

        checkMetadata(html, url, title, realmDescription, "website");
    });

    await test.step("check feed metadata", async () => {
        const feed = "ckBTC";
        const html = await get(`${baseURL}/feed/${feed}`);
        const url = `${BASE_DOMAIN}/#/feed/${feed}`;
        const description = `Latest posts on ${feed}`;

        checkMetadata(html, url, feed, description, "website");
    });

    const [postContent, postId] = await test.step("create post", async () => {
        const postContent = await createPost(page, user);

        const homePage = await globalNavigation.goToHomePage();
        await homePage.showNewPosts();
        const post = await homePage.getPostByContent(postContent);

        const postPage = await post.goToPostPage();
        const postId = postPage.getPostId();

        return [postContent, postId];
    });

    const [commentContext, [commentUser, commentContent, commentId]] =
        await test.step("create comment", async () => {
            return await performInNewContext(browser, async (page) => {
                const user = await createSeedPhraseUser(page);
                const globalNavigation = new GlobalNavigationElement(
                    page,
                    user,
                );

                const homePage = await globalNavigation.goToHomePage();
                await homePage.showNewPosts();

                const post = await homePage.getPostByContent(postContent);
                const commentContent = await post.giveComment();
                const comment = post.getCommentByContent(commentContent);

                const commentPage = await comment.goToPostPage();
                const commentId = commentPage.getPostId();

                return [user, commentContent, commentId];
            });
        });

    await test.step("check post metadata", async () => {
        const html = await get(`${baseURL}/post/${postId}`);
        const url = `${BASE_DOMAIN}/#/post/${postId}`;
        const title = `Post #${postId} by @${user.username}`;

        checkMetadata(html, url, title, postContent, "article");
    });

    await test.step("check comment metadata", async () => {
        const html = await get(`${baseURL}/thread/${commentId}`);
        const url = `${BASE_DOMAIN}/#/thread/${commentId}`;
        const title = `Reply #${commentId} by @${commentUser.username}`;

        checkMetadata(html, url, title, commentContent, "article");
    });

    await commentContext.close();
});
