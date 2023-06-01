import { expect, test } from "@playwright/test";
import { createSeedPhraseUser, performInNewContext } from "../support";
import { GlobalNavigationElement } from "../elements";
import { AcceptInvitePage } from "../pages";

test("user invite", async ({ page, browser }) => {
  const inviteCycles = 100;
  const user = await createSeedPhraseUser(page);
  const globalNavigation = new GlobalNavigationElement(page, user);
  const invitesPage = await globalNavigation.goToInvitesPage();
  const inviteUrl = await invitesPage.createInviteWithCycles(inviteCycles);

  const openInvites = await invitesPage.getOpenInvites();
  expect(openInvites).toHaveLength(1);

  await performInNewContext(browser, async (page) => {
    const acceptInvitePage = new AcceptInvitePage(page, inviteUrl);
    await acceptInvitePage.goto();
    const user = await acceptInvitePage.loginWithSeedPhrase();

    const globalNavigation = new GlobalNavigationElement(page, user);
    const profilePage = await globalNavigation.goToProfilePage();
    const cyclesBalance = await profilePage.getCyclesBalance();
    expect(cyclesBalance).toEqual(inviteCycles);
  });

  await page.reload();
  const openInvitesAfterAccepting = await invitesPage.getOpenInvites();
  expect(openInvitesAfterAccepting).toHaveLength(0);
});
