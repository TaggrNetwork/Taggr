import { expect, test } from "@playwright/test";
import {
    createLedgerClient,
    createSeedPhraseUser,
    generateSubAccount,
    icpToTaggrCyclesRate,
    icpToE8s,
    mintingPrincipal,
} from "../support";
import { GlobalNavigationElement } from "../elements";
import { AccountIdentifier } from "@dfinity/nns";

test("wallet", async ({ page }) => {
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
            expect(amountOnPage).toEqual(icpAfterDeposit - e8sToWithdraw - fee);

            return amountOnPage;
        });

    await test.step("mint cycles", async () => {
        const initialCyclesAmount = await walletPage.getCyclesAmount();
        expect(initialCyclesAmount).toEqual(1_000);

        const kiloCycles = 3;
        await walletPage.mintCycles(kiloCycles);
        const updatedCyclesAmount = await walletPage.getCyclesAmount();
        expect(updatedCyclesAmount).toEqual(
            initialCyclesAmount + kiloCycles * 1_000,
        );

        const icpAmountAfterCycleMinting = await walletPage.getIcpAmount();
        const taggrCyclesRate = await icpToTaggrCyclesRate();
        const amountToDeduct = BigInt(kiloCycles) * taggrCyclesRate;
        const roundedAmountToDeduct =
            (amountToDeduct / BigInt(100_000)) * BigInt(100_000);

        expect(icpAmountAfterCycleMinting).toEqual(
            icpAfterWithdraw - roundedAmountToDeduct,
        );
    });
});
