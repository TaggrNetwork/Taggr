import { expect, test } from "@playwright/test";
import {
  AuthenticatedHomePage,
  HomePage,
  MintInitialCyclesPage,
  SettingsPage,
} from "../pages";
import { createLedgerClient, generateUsername } from "../support";

// [TODO] - enable this test when agent-js@0.15.7 or higher is released
test.skip("sign up with internet identity", async ({ page, baseURL }) => {
  const homePage = new HomePage(page);
  await homePage.goto();

  const internetIdentityPage = await homePage.openInternetIdentityLoginPage();
  const anchor = await internetIdentityPage.createAnchor();
  expect(anchor).toBeTruthy();

  const mintInitialCyclesPage = new MintInitialCyclesPage(page);
  await mintInitialCyclesPage.mintCycles();

  const icpAmount = await mintInitialCyclesPage.getIcpAmount();
  expect(icpAmount).toBeTruthy();

  const icpAccount = await mintInitialCyclesPage.getIcpAccount();
  expect(icpAccount).toBeTruthy();

  const ledger = await createLedgerClient(baseURL);
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

  const authenticatedHomePage = new AuthenticatedHomePage(page);
  await expect(homePage.welcomeAboardHeader).not.toBeVisible();
  await expect(homePage.connectButton).not.toBeVisible();
  await expect(authenticatedHomePage.burgerButton).toBeVisible();
});
