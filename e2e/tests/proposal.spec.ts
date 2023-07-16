import { BrowserContext, expect, test } from "@playwright/test";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
    SeedPhraseUser,
    createSeedPhraseUser,
    demiGodMode,
    generateGitCommitHash,
    generateText,
    godMode,
    peasantMode,
    performInExistingContext,
    performInNewContext,
} from "../support";
import { GlobalNavigationElement } from "../elements";

async function hashFile(filePath: string): Promise<string> {
    const hash = createHash("sha256");
    const file = await readFile(filePath);
    hash.update(file);

    return hash.digest("hex");
}

// we must run these tests in series because we are creating proprosals,
// which will cancel each other if run in parallel
test.describe.configure({ mode: "serial" });

let stalwart: SeedPhraseUser;
let stalwartContext: BrowserContext;

let trustedUser: SeedPhraseUser;
let trustedUserContext: BrowserContext;

// these tests rely on having a stalwart and a trusted user
// if we create multiple of these users then it will affect the token
// distribution and the tests will fail
test.beforeAll(async ({ browser }) => {
    const [contextOne] = await performInNewContext(browser, async (page) => {
        stalwart = await createSeedPhraseUser(page);
        await godMode(stalwart.username);
    });
    stalwartContext = contextOne;

    const [contextTwo] = await performInNewContext(browser, async (page) => {
        trustedUser = await createSeedPhraseUser(page);
        await demiGodMode(trustedUser.username);
    });
    trustedUserContext = contextTwo;
});

test.afterAll(async () => {
    await peasantMode(stalwart.username);
    await peasantMode(trustedUser.username);
});

test("adopt a release proposal", async () => {
    test.setTimeout(40000);

    const [buildHash, proposalDescription] =
        await test.step("create proposal", async () => {
            return await performInExistingContext(
                stalwartContext,
                async (page) => {
                    const globalNavigation = new GlobalNavigationElement(
                        page,
                        stalwart,
                    );
                    const proposalsPage =
                        await globalNavigation.goToProposalsPage();
                    const commitHash = generateGitCommitHash();
                    const binaryPath = resolve(
                        __dirname,
                        "..",
                        "..",
                        "target",
                        "wasm32-unknown-unknown",
                        "release",
                        "taggr.wasm.gz",
                    );
                    const description = generateText();

                    await proposalsPage.createReleaseProposal(
                        commitHash,
                        binaryPath,
                        description,
                    );
                    const buildHash = await hashFile(binaryPath);

                    return [buildHash, description];
                },
            );
        });

    await test.step("accept proposal", async () => {
        await performInExistingContext(trustedUserContext, async (page) => {
            const globalNavigation = new GlobalNavigationElement(
                page,
                trustedUser,
            );
            const proposalsPage = await globalNavigation.goToProposalsPage();

            const proposal = await proposalsPage.getProposalByContent(
                proposalDescription,
            );
            expect(proposal.statusElement).toHaveText("OPEN");

            await proposal.accept(buildHash);
            expect(proposal.statusElement).toHaveText("EXECUTED");
        });
    });
});

test("reject a release proposal", async () => {
    test.setTimeout(40000);

    const proposalDescription = await test.step("create proposal", async () => {
        return await performInExistingContext(stalwartContext, async (page) => {
            const globalNavigation = new GlobalNavigationElement(
                page,
                stalwart,
            );
            const proposalsPage = await globalNavigation.goToProposalsPage();
            const commitHash = generateGitCommitHash();
            const binaryPath = resolve(
                __dirname,
                "..",
                "..",
                "target",
                "wasm32-unknown-unknown",
                "release",
                "taggr.wasm.gz",
            );
            const description = generateText();

            await proposalsPage.createReleaseProposal(
                commitHash,
                binaryPath,
                description,
            );

            return description;
        });
    });

    await test.step("reject proposal", async () => {
        await performInExistingContext(trustedUserContext, async (page) => {
            const globalNavigation = new GlobalNavigationElement(
                page,
                trustedUser,
            );
            const proposalsPage = await globalNavigation.goToProposalsPage();

            const proposal = await proposalsPage.getProposalByContent(
                proposalDescription,
            );
            expect(proposal.statusElement).toHaveText("OPEN");

            await proposal.reject();
            expect(proposal.statusElement).toHaveText("OPEN");
        });

        await performInExistingContext(stalwartContext, async (page) => {
            const globalNavigation = new GlobalNavigationElement(
                page,
                stalwart,
            );
            const proposalsPage = await globalNavigation.goToProposalsPage();
            const proposal = await proposalsPage.getProposalByContent(
                proposalDescription,
            );

            await proposal.reject();
            expect(proposal.statusElement).toHaveText("REJECTED");
        });
    });
});
