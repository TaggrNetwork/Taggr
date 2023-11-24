import { Page, expect } from "@playwright/test";
import { AccountIdentifier } from "@dfinity/nns";
import { HomePage, MintInitialCreditsPage, SettingsPage } from "../pages";
import { createLedgerClient } from "./ledger";
import {
    generateAboutYou,
    generateSeedPhrase,
    generateUsername,
} from "./random_data";

export interface InternetIdentityUser extends CommonUser {
    anchor: string;
}

// [TODO] - currently not used, use when agent-js@0.15.7 or higher is released
export async function createInternetIdentityUser(
    page: Page,
): Promise<InternetIdentityUser> {
    const homePage = new HomePage(page);
    await homePage.goto();

    const internetIdentityPage = await homePage.openInternetIdentityLoginPage();
    const anchor = await internetIdentityPage.createAnchor();
    expect(anchor).toBeTruthy();

    const userCommon = await completeUserSignup(page);

    return {
        ...userCommon,
        anchor,
    };
}

export interface SeedPhraseUser extends CommonUser {
    seedPhrase: string;
}

export async function createSeedPhraseUser(
    page: Page,
): Promise<SeedPhraseUser> {
    const homePage = new HomePage(page);
    await homePage.goto();

    const seedPhrase = generateSeedPhrase();
    await homePage.loginWithSeedPhrase(seedPhrase);

    const userCommon = await completeUserSignup(page);

    return {
        ...userCommon,
        seedPhrase,
    };
}

export interface CommonUser {
    icpAccount: AccountIdentifier;
    username: string;
    about: string;
}

async function completeUserSignup(page: Page): Promise<CommonUser> {
    const mintInitialCreditsPage = new MintInitialCreditsPage(page);
    await mintInitialCreditsPage.mintCredits();

    const icpAmount = await mintInitialCreditsPage.getIcpAmount();
    expect(icpAmount).toBeTruthy();

    const icpAccount = await mintInitialCreditsPage.getIcpAccount();
    expect(icpAccount).toBeTruthy();

    const ledger = await createLedgerClient();
    await ledger.transfer({
        amount: icpAmount,
        to: icpAccount,
    });

    await mintInitialCreditsPage.checkPayment();
    await mintInitialCreditsPage.createUser();

    const settingsPage = new SettingsPage(page);

    const username = generateUsername();
    await settingsPage.setUsername(username);

    const about = generateAboutYou();
    await settingsPage.setAboutYou(about);

    await settingsPage.save();

    return {
        icpAccount,
        username,
        about,
    };
}
