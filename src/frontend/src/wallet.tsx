import * as React from "react";
import {
    CopyToClipboard,
    confirmPopUp,
    hex,
    ICPAccountBalance,
    tokenBalance,
    icpCode,
    ButtonWithLoading,
    bigScreen,
    ICP_LEDGER_ID,
    icrcTransfer,
    parseNumber,
    promptPopUp,
    tokens,
    ICP_DEFAULT_FEE,
    handleError,
    errorText,
    onCanonicalDomain,
    UnavailableOnCustomDomains,
} from "./common";
import { Principal } from "@icp-sdk/core/principal";
import { CANISTER_ID } from "./env";
import { Icrc1TokensWallet } from "./tokens_wallet";

const coldWalletFunctionalityAvailable = window.ic && window.ic.plug;

export const Wallet = () => {
    const [user, setUser] = React.useState(window.user);
    const [walletError, setWalletError] = React.useState("");
    const principalAddress = React.useMemo(
        () => Principal.fromText(user.principal),
        [user.principal],
    );
    const mintCredits = async (kilo_credits: number) =>
        await window.api.call("mint_credits_with_icp", kilo_credits);

    if (!onCanonicalDomain())
        return (
            <UnavailableOnCustomDomains
                component="User wallet"
                classNameArg="top_spaced"
            />
        );

    let { token_symbol, token_decimals, transaction_fee } =
        window.backendCache.config;

    return (
        <div className="spaced">
            <hr />
            {user.cycles <= 200 && (
                <div className="banner bottom_spaced">
                    You are low on credits! Please transfer some ICP to your
                    account displayed below and press the MINT button.
                </div>
            )}
            {walletError && (
                <div className="error bottom_spaced" role="alert">
                    {walletError}
                </div>
            )}
            <div className="column_container">
                <div className="row_container bottom_spaced">
                    <div className="max_width_col">Principal</div>
                    <code>
                        <CopyToClipboard
                            value={user.principal}
                            displayMap={(val) =>
                                bigScreen() ? val : val.split("-")[0]
                            }
                        />
                    </code>
                </div>
                <div className="row_container">
                    <div className="max_width_col">ICP account</div>
                    <code>
                        <CopyToClipboard
                            value={user.account}
                            displayMap={(val) => (
                                <a
                                    href={`https://dashboard.internetcomputer.org/account/${val}`}
                                >
                                    {bigScreen() ? val : val.slice(0, 8)}
                                </a>
                            )}
                        />
                    </code>
                </div>
            </div>
            <hr />
            <div className="vcentered">
                <h2 className="max_width_col">ICP</h2>
                {Number(user.treasury_e8s) > 0 && (
                    <ButtonWithLoading
                        label="Withdraw rewards"
                        onClick={async () => {
                            let result =
                                await window.api.call<any>("withdraw_rewards");
                            handleError(result, undefined, setWalletError);
                            await window.reloadUser();
                            setUser(window.user);
                        }}
                    />
                )}
                <ButtonWithLoading
                    label="Send"
                    testId="icp-transfer-button"
                    onClick={async () => {
                        setWalletError("");
                        try {
                            const recipient =
                                (
                                    await promptPopUp(
                                        "Enter the recipient principal or ICP account address",
                                    )
                                )?.trim() || "";
                            if (!recipient) return;
                            if (recipient.length == 64) {
                                const amount = parseNumber(
                                    (
                                        await promptPopUp(
                                            `Enter the amount (fee: ${tokens(
                                                ICP_DEFAULT_FEE,
                                                8,
                                            )} ICP)`,
                                        )
                                    )?.trim() || "",
                                    8,
                                );
                                if (
                                    !amount ||
                                    !(await confirmPopUp(
                                        `You are transferring\n\n${tokens(
                                            amount,
                                            8,
                                        )} ICP\n\nto\n\n${recipient}`,
                                    ))
                                )
                                    return;
                                let response: any =
                                    await window.api.icp_transfer(
                                        recipient,
                                        amount,
                                    );
                                if (
                                    handleError(
                                        response,
                                        "Transfer failed",
                                        setWalletError,
                                    )
                                )
                                    console.error(response);
                                await window.reloadUser();
                                setUser(window.user);
                                return;
                            }
                            const response = await icrcTransfer(
                                ICP_LEDGER_ID,
                                "ICP",
                                8,
                                ICP_DEFAULT_FEE,
                                recipient,
                            );
                            if (response === undefined) return; // cancelled
                            if (
                                response === null ||
                                Number.isNaN(Number(response))
                            )
                                setWalletError(`Transfer failed: ${response}`);
                            await window.reloadUser();
                            setUser(window.user);
                        } catch (e) {
                            setWalletError(errorText(e));
                        }
                    }}
                />
            </div>
            <div className="vcentered">
                <div className="max_width_col">Wallet</div>
                <code data-testid="icp-balance">
                    <ICPAccountBalance
                        heartbeat={user}
                        address={principalAddress}
                        units={false}
                        decimals={8}
                    />
                </code>
            </div>
            {Number(user.treasury_e8s) > 0 && (
                <div className="vcentered top_spaced">
                    <div className="max_width_col">Rewards</div>
                    <code className="accent">
                        {icpCode(user.treasury_e8s, 8, false)}
                    </code>
                </div>
            )}
            <hr />
            <div className="vcentered">
                <h2 className="max_width_col">Credits</h2>
                <ButtonWithLoading
                    label="Mint"
                    onClick={async () => {
                        setWalletError("");
                        const future_invoice = window.api.call<any>(
                            "mint_credits_with_icp",
                            0,
                        );
                        const maxKilos =
                            window.backendCache.config.max_credits_mint_kilos;
                        const kilo_credits = parseInt(
                            (await promptPopUp(
                                "Enter the number of 1000s of credits to mint " +
                                    `(max: ${maxKilos})`,
                                "1",
                            )) || "0",
                        );
                        if (Number(kilo_credits) > maxKilos) {
                            setWalletError(
                                `You can't mint more than ${
                                    1000 * maxKilos
                                } credits at once.`,
                            );
                            return;
                        }
                        if (!kilo_credits || isNaN(kilo_credits)) {
                            return;
                        }
                        if (kilo_credits < 0) {
                            return;
                        }
                        const invoice_result = await future_invoice;
                        if (
                            handleError(
                                invoice_result,
                                undefined,
                                setWalletError,
                            )
                        )
                            return;
                        const { account, e8s } = invoice_result.Ok;
                        const userSubaccount = hex(account);
                        const amount = Number(e8s) * kilo_credits;
                        const response: any = await window.api.icp_transfer(
                            userSubaccount,
                            amount,
                        );
                        if (!response || "Err" in response) {
                            setWalletError(
                                `Couldn't transfer ICP for minting. Make sure you have at least ${tokens(
                                    amount + ICP_DEFAULT_FEE,
                                    8,
                                )} ICP on your wallet and try again.`,
                            );
                            return;
                        }
                        const result: any = await mintCredits(kilo_credits);
                        if (handleError(result, undefined, setWalletError))
                            return;
                        const invoice = result.Ok;
                        if (invoice.paid) {
                            await window.reloadUser();
                            setUser(window.user);
                        }
                    }}
                />
            </div>
            <div className="vcentered">
                <div className="max_width_col">Available</div>
                <code className="xx_large_text" data-testid="credits-balance">
                    {user.cycles.toLocaleString()}
                </code>
            </div>
            <hr />
            <div className="vcentered">
                <h2 className="max_width_col">{token_symbol}</h2>
                {!user.cold_wallet && coldWalletFunctionalityAvailable && (
                    <ButtonWithLoading
                        onClick={async () => {
                            const actor = await getActor();
                            const response = await actor.link_cold_wallet(
                                window.user.id,
                            );
                            if (
                                handleError(response, undefined, setWalletError)
                            )
                                return;
                            await window.reloadUser();
                            setUser(window.user);
                        }}
                        label="Link cold wallet"
                    />
                )}
                {user.cold_wallet && (
                    <ButtonWithLoading
                        onClick={async () => {
                            if (
                                !(await confirmPopUp(
                                    "Unlinking the cold wallet reduces your voting power. " +
                                        "\n\n" +
                                        "Please confirm the unlinking.",
                                ))
                            )
                                return;
                            const response: any =
                                await window.api.unlink_cold_wallet();
                            if (
                                handleError(response, undefined, setWalletError)
                            )
                                return;
                            await window.reloadUser();
                            setUser(window.user);
                        }}
                        label="Unlink cold wallet"
                    />
                )}
                <ButtonWithLoading
                    label="Send"
                    testId="tokens-transfer-button"
                    onClick={async () => {
                        setWalletError("");
                        const response = await icrcTransfer(
                            Principal.fromText(CANISTER_ID),
                            token_symbol,
                            token_decimals,
                            transaction_fee,
                        );
                        if (response === undefined) return; // cancelled
                        if (response === null || Number.isNaN(Number(response)))
                            setWalletError(String(response));
                        await window.reloadUser();
                        setUser(window.user);
                    }}
                />
            </div>
            <div className="row_container vcentered">
                <div className="max_width_col">Wallet </div>
                <a
                    data-testid="token-balance"
                    className="xx_large_text"
                    href={`#/transactions/${user.principal}`}
                >
                    {tokenBalance(user.balance)}
                </a>
            </div>
            {user.cold_wallet && (
                <div className="row_container vcentered">
                    <div className="max_width_col">Cold wallet</div>
                    <a
                        className="xx_large_text"
                        href={`#/transactions/${user.cold_wallet}`}
                    >
                        {tokenBalance(user.cold_balance)}
                    </a>
                </div>
            )}
            {user.settings.icrcWallet == "true" && (
                <>
                    <hr />
                    <Icrc1TokensWallet />
                </>
            )}
        </div>
    );
};

const getActor = async () => {
    await window.ic.plug.requestConnect({
        host: window.location.origin,
    });
    return await window.ic.plug.createActor({
        canisterId: CANISTER_ID,
        interfaceFactory: ({ IDL }: any) =>
            IDL.Service({
                link_cold_wallet: IDL.Func(
                    [IDL.Nat64],
                    [IDL.Variant({ Ok: IDL.Null, Err: IDL.Null })],
                    [],
                ),
            }),
    });
};
