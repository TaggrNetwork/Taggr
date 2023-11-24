import { expect, test } from "@playwright/test";
import {
    createLedgerClient,
    createSeedPhraseUser,
    generateSubAccount,
    icpToTaggrCreditsRate,
    icpToE8s,
    mintingPrincipal,
} from "../support";
import { GlobalNavigationElement } from "../elements";
import { AccountIdentifier } from "@dfinity/ledger-icp";

test("wallet", async ({ page }) => {
    const first4Digits = (n: BigInt) => Math.floor(Number(n) / 100000);
    const ledger = await createLedgerClient();

    const user = await test.step("create user", async () => {
        return await createSeedPhraseUser(page);
    });

    const walletPage = await test.step("go to wallet page", async () => {
        const globalNavigation = new GlobalNavigationElement(page, user);
        await globalNavigation.goToHomePage();

        return await globalNavigation.goToWalletPage();
    });

    const icpAfterDeposit =
        await test.step("transfer ICP to wallet", async () => {
            const initialAmountOnPage = await walletPage.getIcpAmount();
            expect(initialAmountOnPage).toEqual(BigInt(0));

            const amount = icpToE8s(10);
            const to = await walletPage.getIcpAccount();
            await ledger.transfer({ amount, to });

            await page.reload({ waitUntil: "networkidle" });
            const amountOnPage = await walletPage.getIcpAmount();
            expect(amountOnPage).toEqual(amount);

            return amountOnPage;
        });

    const icpAfterWithdraw =
        await test.step("transfer ICP out of wallet", async () => {
            const amountToWithdraw = 5;
            const e8sToWithdraw = icpToE8s(amountToWithdraw);
            const subAccount = generateSubAccount();
            const outAccount = AccountIdentifier.fromPrincipal({
                principal: mintingPrincipal,
                subAccount,
            });

            const originalBalance = await ledger.accountBalance({
                accountIdentifier: outAccount,
            });

            await walletPage.transferIcp(amountToWithdraw, outAccount.toHex());

            const transferredAmount = await ledger.accountBalance({
                accountIdentifier: outAccount,
            });
            const fee = await ledger.transactionFee();
            expect(transferredAmount).toEqual(originalBalance + e8sToWithdraw);

            const amountOnPage = await walletPage.getIcpAmount();
            expect(first4Digits(amountOnPage)).toEqual(
                first4Digits(icpAfterDeposit - e8sToWithdraw - fee),
            );

            return amountOnPage;
        });

    await test.step("mint Credits", async () => {
        const initialCreditsAmount = await walletPage.getCreditsAmount();
        expect(initialCreditsAmount).toEqual(1_000);

        const kiloCredits = 3;
        await walletPage.mintCredits(kiloCredits);
        const updatedCreditsAmount = await walletPage.getCreditsAmount();
        expect(updatedCreditsAmount).toEqual(
            initialCreditsAmount + kiloCredits * 1_000,
        );

        const icpAmountAfterCreditMinting = await walletPage.getIcpAmount();
        const taggrCreditsRate = await icpToTaggrCreditsRate();
        const amountToDeduct = BigInt(kiloCredits) * taggrCreditsRate;
        const roundedAmountToDeduct =
            (amountToDeduct / BigInt(100_000)) * BigInt(100_000);

        expect(first4Digits(icpAmountAfterCreditMinting)).toEqual(
            first4Digits(icpAfterWithdraw - roundedAmountToDeduct),
        );
    });
});
