import { Page, expect } from "@playwright/test";
import { AccountIdentifier } from "@dfinity/nns";
import { HomePage, MintInitialCyclesPage, SettingsPage } from "../pages";
import { createLedgerClient } from "./ledger";
import { generateSeedPhrase, generateUsername } from "./random_data";

export interface InternetIdentityUser extends CommonUser {
  anchor: string;
}

// [TODO] - currently not used, use when agent-js@0.15.7 or higher is released
export async function createInternetIdentityUser(
  page: Page
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
  page: Page
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

interface CommonUser {
  icpAccount: AccountIdentifier;
  username: string;
}

async function completeUserSignup(page: Page): Promise<CommonUser> {
  const mintInitialCyclesPage = new MintInitialCyclesPage(page);
  await mintInitialCyclesPage.mintCycles();

  const icpAmount = await mintInitialCyclesPage.getIcpAmount();
  expect(icpAmount).toBeTruthy();

  const icpAccount = await mintInitialCyclesPage.getIcpAccount();
  expect(icpAccount).toBeTruthy();

  const ledger = await createLedgerClient();
  await ledger.transfer({
    amount: icpAmount,
    to: icpAccount,
  });

  await mintInitialCyclesPage.checkPayment();
  await mintInitialCyclesPage.createUser();

  const settingsPage = new SettingsPage(page);
  const username = generateUsername();
  await settingsPage.setUsername(username);
  await settingsPage.save();

  return {
    icpAccount,
    username,
  };
}
