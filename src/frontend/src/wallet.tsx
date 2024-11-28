import {
    shortenAccount,
    CopyToClipboard,
    HeadBar,
    Loading,
    hex,
    ICPAccountBalance,
    tokenBalance,
    icpCode,
    ButtonWithLoading,
    bigScreen,
    USD_PER_XDR,
    ICP_LEDGER_ID,
    icrcTransfer,
    parseNumber,
    tokens,
    ICP_DEFAULT_FEE,
    HASH_ITERATIONS,
    hash,
    logout,
} from "./common";
import * as React from "react";
import { LoginMasks, SeedPhraseForm } from "./logins";
import { Ed25519KeyIdentity } from "@dfinity/identity";
import { Principal } from "@dfinity/principal";
import { CANISTER_ID } from "./env";

type Invoice = { paid: boolean; e8s: BigInt; account: number[] };

const coldWalletFunctionalityAvailable = window.ic && window.ic.plug;

export const Welcome = () => {
    const [invoice, setInvoice] = React.useState<Invoice>();
    const [loadingInvoice, setLoadingInvoice] = React.useState(false);
    const [seedPhraseConfirmed, setSeedPhraseConfirmed] = React.useState(false);

    const checkPayment = async () => {
        setLoadingInvoice(true);
        const result = await window.api.call<any>("mint_credits", 0);
        setLoadingInvoice(false);
        if ("Err" in result) {
            alert(`Error: ${result.Err}`);
            return;
        }
        setInvoice(result.Ok);
    };

    const passwordConfirmationRequired =
        !!localStorage.getItem("SEED_PHRASE") && !seedPhraseConfirmed;
    const logOutButton = (
        <button className="right_spaced" onClick={() => logout()}>
            LOGOUT
        </button>
    );

    return (
        <>
            <HeadBar title={"WELCOME!"} shareLink="welcome" />
            <div className="spaced">
                {passwordConfirmationRequired && (
                    <>
                        <h2>New user detected</h2>
                        <p>Please re-enter your password to confirm it.</p>
                        <SeedPhraseForm
                            classNameArg=""
                            confirmationRequired={false}
                            callback={async (password: string) => {
                                const seed = await hash(
                                    password,
                                    HASH_ITERATIONS,
                                );
                                let identity =
                                    Ed25519KeyIdentity.generate(seed);
                                if (
                                    identity.getPrincipal().toString() !=
                                    window.getPrincipalId()
                                ) {
                                    alert(
                                        "The seed phrase does not match! Please log-out and try again.",
                                    );
                                    return;
                                } else setSeedPhraseConfirmed(true);
                            }}
                        />
                    </>
                )}
                {!passwordConfirmationRequired && (
                    <>
                        {(!invoice || !invoice.paid) && (
                            <div className="bottom_spaced">
                                <h2>New user detected</h2>
                                Your {window.backendCache.config.name}{" "}
                                principal:{" "}
                                <CopyToClipboard
                                    value={window.getPrincipalId()}
                                    displayMap={(principal) =>
                                        bigScreen()
                                            ? principal
                                            : shortenPrincipal(principal)
                                    }
                                />
                                <h2>JOINING</h2>
                                <p>
                                    To join {window.backendCache.config.name}{" "}
                                    you need "credits". Credits are app-internal
                                    tokens which you spend as a "gas" while
                                    using the app. You can mint credits yourself
                                    or you can use an invite pre-charged with
                                    credits created by another{" "}
                                    {window.backendCache.config.name} user. Ask
                                    around on socials for an invite or keep
                                    reading to get on board faster.
                                </p>
                                <p>
                                    To mint credits, you need to transfer a
                                    small amount of ICP to an account controlled
                                    by the {window.backendCache.config.name}{" "}
                                    canister. You get <code>1000</code> credits
                                    for as little as{" "}
                                    <code>~{USD_PER_XDR} USD</code> (corresponds
                                    to 1{" "}
                                    <a href="https://en.wikipedia.org/wiki/Special_drawing_rights">
                                        XDR
                                    </a>
                                    ). Before you mint credits, make sure you
                                    understand{" "}
                                    <a href="#/whitepaper">
                                        how {window.backendCache.config.name}{" "}
                                        works
                                    </a>
                                    !
                                </p>
                                <p>Ready to mint? Continue below!</p>
                            </div>
                        )}
                        {loadingInvoice && (
                            <div className="text_centered stands_out">
                                Checking the balance...
                                <br />
                                <small>(This can take up to a minute.)</small>
                                <Loading />
                            </div>
                        )}
                        {!loadingInvoice && (
                            <>
                                {!invoice && (
                                    <>
                                        {logOutButton}
                                        <button
                                            className="active vertically_spaced"
                                            onClick={checkPayment}
                                        >
                                            MINT CREDITS
                                        </button>
                                    </>
                                )}
                                {invoice && (
                                    <>
                                        {invoice.paid && (
                                            <div>
                                                <h2>CREDITS MINTED! ✅</h2>
                                                <p>
                                                    You can create a user
                                                    account now.
                                                </p>
                                                <button
                                                    className="active top_spaced"
                                                    onClick={() =>
                                                        (location.href =
                                                            "/#/settings")
                                                    }
                                                >
                                                    CREATE USER
                                                </button>
                                            </div>
                                        )}
                                        {!invoice.paid && (
                                            <>
                                                Please transfer at least&nbsp;
                                                <CopyToClipboard
                                                    testId="invoice-amount"
                                                    value={(
                                                        Number(invoice.e8s) /
                                                        1e8
                                                    ).toString()}
                                                />
                                                &nbsp;ICP to account
                                                <br />
                                                <CopyToClipboard
                                                    value={hex(invoice.account)}
                                                    displayMap={(account) =>
                                                        bigScreen()
                                                            ? account
                                                            : shortenAccount(
                                                                  account,
                                                              )
                                                    }
                                                    testId="account-to-transfer-to"
                                                />{" "}
                                                to mint <code>1000</code>{" "}
                                                credits.
                                                <br />
                                                <br />
                                                If you transfer a larger amount,
                                                the surplus will end up in your
                                                ICP wallet after you have
                                                created the user account.
                                                <br />
                                                <br />
                                                <button
                                                    className="active"
                                                    onClick={checkPayment}
                                                >
                                                    CHECK BALANCE
                                                </button>
                                            </>
                                        )}
                                    </>
                                )}
                            </>
                        )}
                    </>
                )}
            </div>
        </>
    );
};

const shortenPrincipal = (principal: string) => {
    const parts = principal.split("-");
    return `${parts[0]}-...-${parts[parts.length - 1]}`;
};

export const Wallet = () => {
    const [user, setUser] = React.useState(window.user);
    const mintCredits = async (kilo_credits: number) =>
        await window.api.call("mint_credits", kilo_credits);

    let { token_symbol, token_decimals, transaction_fee } =
        window.backendCache.config;

    return (
        <>
            <hr />
            {user.cycles <= 200 && (
                <div className="banner bottom_spaced">
                    You are low on credits! Please transfer some ICP to your
                    account displayed below and press the MINT button.
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
                    <div className="max_width_col">ICP Account</div>
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
                        label="WITHDRAW REWARDS"
                        onClick={async () => {
                            let result =
                                await window.api.call<any>("withdraw_rewards");
                            if ("Err" in result) alert(`Error: ${result.Err}`);
                            await window.reloadUser();
                            setUser(window.user);
                        }}
                    />
                )}
                <ButtonWithLoading
                    label="SEND"
                    testId="icp-transfer-button"
                    onClick={async () => {
                        try {
                            const recipient =
                                prompt(
                                    "Enter the recipient principal or ICP account address",
                                )?.trim() || "";
                            if (!recipient) return;
                            if (recipient.length == 64) {
                                const amount = parseNumber(
                                    prompt(
                                        `Enter the amount (fee: ${tokens(
                                            ICP_DEFAULT_FEE,
                                            8,
                                        )} ICP)`,
                                    )?.trim() || "",
                                    8,
                                );
                                if (
                                    !amount ||
                                    !confirm(
                                        `You are transferring\n\n${tokens(
                                            amount,
                                            8,
                                        )} ICP\n\nto\n\n${recipient}`,
                                    )
                                )
                                    return;
                                let response: any =
                                    await window.api.icp_transfer(
                                        recipient,
                                        amount,
                                    );
                                if ("Err" in response) {
                                    console.error(response);
                                    alert("Transfer failed");
                                }
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
                            if (typeof response == "string")
                                alert(`Transfer failed: ${response}`);
                            await window.reloadUser();
                            setUser(window.user);
                        } catch (e) {
                            alert(e);
                        }
                    }}
                />
            </div>
            <div className="vcentered">
                <div className="max_width_col">Wallet</div>
                <code data-testid="icp-balance">
                    <ICPAccountBalance
                        heartbeat={new Date()}
                        address={Principal.fromText(user.principal)}
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
                    label="MINT"
                    onClick={async () => {
                        const future_invoice = window.api.call<any>(
                            "mint_credits",
                            0,
                        );
                        const maxKilos =
                            window.backendCache.config.max_credits_mint_kilos;
                        const kilo_credits = parseInt(
                            prompt(
                                "Enter the number of 1000s of credits to mint " +
                                    `(max: ${maxKilos})`,
                                "1",
                            ) || "0",
                        );
                        if (Number(kilo_credits) > maxKilos) {
                            alert(
                                `You can't mint more than ${
                                    1000 * maxKilos
                                } credits at once.`,
                            );
                            return;
                        }
                        if (!kilo_credits || isNaN(kilo_credits)) {
                            return;
                        }
                        const invoice_result = await future_invoice;
                        if ("Err" in invoice_result) {
                            alert(`Error: ${invoice_result.Err}`);
                            return;
                        }
                        const { account, e8s } = invoice_result.Ok;
                        const userSubaccount = hex(account);
                        const amount = Number(e8s) * kilo_credits;
                        const response: any = await window.api.icp_transfer(
                            userSubaccount,
                            amount,
                        );
                        if ("Err" in response) {
                            alert(
                                `Couldn't transfer ICP for minting. Make sure you have at least ${tokens(
                                    amount + ICP_DEFAULT_FEE,
                                    8,
                                )} ICP on your wallet and try again.`,
                            );
                        }
                        const result: any = await mintCredits(kilo_credits);
                        if ("Err" in result) {
                            alert(`Error: ${result.Err}`);
                            return;
                        }
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
                        classNameArg="fat"
                        onClick={async () => {
                            const actor = await getActor();
                            const response = await actor.link_cold_wallet(
                                window.user.id,
                            );
                            if (response && "Err" in response) {
                                alert(`Error: ${response.Err}`);
                                return;
                            }
                            await window.reloadUser();
                            setUser(window.user);
                        }}
                        label="LINK COLD WALLET"
                    />
                )}
                {user.cold_wallet && (
                    <ButtonWithLoading
                        classNameArg="fat"
                        onClick={async () => {
                            if (
                                !confirm(
                                    "Unlinking of the cold wallet leads to the reduction of your voting power. " +
                                        "\n\n" +
                                        "Please confirm the unlinking.",
                                )
                            )
                                return;
                            const response: any =
                                await window.api.unlink_cold_wallet();
                            if (response && "Err" in response) {
                                alert(`Error: ${response.Err}`);
                                return;
                            }
                            await window.reloadUser();
                            setUser(window.user);
                        }}
                        label="UNLINK COLD WALLET"
                    />
                )}
                <ButtonWithLoading
                    label="SEND"
                    testId="tokens-transfer-button"
                    onClick={async () => {
                        const response = await icrcTransfer(
                            Principal.fromText(CANISTER_ID),
                            token_symbol,
                            token_decimals,
                            transaction_fee,
                        );
                        if (typeof response == "string")
                            alert(`Error: ${JSON.stringify(response)}`);
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
                    <div className="max_width_col">Cold Wallet</div>
                    <a
                        className="xx_large_text"
                        href={`#/transactions/${user.cold_wallet}`}
                    >
                        {tokenBalance(user.cold_balance)}
                    </a>
                </div>
            )}
        </>
    );
};

export const WelcomeInvited = ({}) => (
    <div className="text_centered">
        <h1>Welcome!</h1>
        <p className="larger_text">
            You were invited to {window.backendCache.config.name}!
        </p>
        <p className="large_text">
            Please select an authentication method and create your user account.
        </p>
        <LoginMasks confirmationRequired={true} />
    </div>
);

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
