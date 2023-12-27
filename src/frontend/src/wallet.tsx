import {
    CopyToClipboard,
    HeadBar,
    Loading,
    hex,
    ICPAccountBalance,
    tokenBalance,
    icpCode,
    ButtonWithLoading,
    bigScreen,
    XDR_TO_USD,
    ICP_LEDGER_ID,
    icrcTransfer,
    parseNumber,
    tokens,
    ICP_DEFAULT_FEE,
} from "./common";
import * as React from "react";
import { LoginMasks, logout, SeedPhraseForm } from "./logins";
import { Ed25519KeyIdentity } from "@dfinity/identity";
import { TransactionsView } from "./tokens";
import { Principal } from "@dfinity/principal";
import { CANISTER_ID } from "./env";

type Invoice = { paid: boolean; e8s: BigInt; account: number[] };

const Welcome = () => {
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
                            callback={async (seed: string) => {
                                const hash = new Uint8Array(
                                    await crypto.subtle.digest(
                                        "SHA-256",
                                        new TextEncoder().encode(seed),
                                    ),
                                );
                                let identity =
                                    Ed25519KeyIdentity.generate(hash);
                                if (
                                    identity.getPrincipal().toString() !=
                                    window.principalId
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
                                    value={window.principalId}
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
                                    <code>~{XDR_TO_USD} USD</code> (corresponds
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
                                                    value={(
                                                        Number(invoice.e8s) /
                                                        1e8
                                                    ).toString()}
                                                    testId="amount-to-transfer"
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

const shortenAccount = (account: string) =>
    `${account.slice(0, 6)}..${account.substr(account.length - 6)}`;

const shortenPrincipal = (principal: string) => {
    const parts = principal.split("-");
    return `${parts[0]}-...-${parts[parts.length - 1]}`;
};

export const Wallet = () => {
    const [user, setUser] = React.useState(window.user);
    const mintCredits = async (kilo_credits: number) =>
        await window.api.call("mint_credits", kilo_credits);

    if (!user) return <Welcome />;
    let { token_symbol, token_decimals, transaction_fee } =
        window.backendCache.config;

    return (
        <>
            <HeadBar title="WALLET" shareLink="wallets" />
            {user.cycles <= 200 && (
                <div className="banner bottom_spaced">
                    You are low on credits! Please transfer some ICP to your
                    account displayed below and press the MINT button.
                </div>
            )}
            <div className="stands_out row_container">
                <div className="max_width_col">YOUR PRINCIPAL</div>
                <code>
                    <CopyToClipboard
                        value={user.principal}
                        displayMap={(val) =>
                            bigScreen() ? val : val.split("-")[0]
                        }
                    />
                </code>
            </div>
            <div className="stands_out">
                <div className="vcentered">
                    <h2 className="max_width_col">ICP</h2>
                    {Number(user.treasury_e8s) > 0 && (
                        <ButtonWithLoading
                            label="WITHDRAW REWARDS"
                            onClick={async () => {
                                let result =
                                    await window.api.call<any>(
                                        "withdraw_rewards",
                                    );
                                if ("Err" in result)
                                    alert(`Error: ${result.Err}`);
                                await window.reloadUser();
                                setUser(window.user);
                            }}
                        />
                    )}
                    <ButtonWithLoading
                        label="TRANSFER"
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
                                    if (!amount) return;
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
                                await icrcTransfer(
                                    ICP_LEDGER_ID,
                                    "ICP",
                                    8,
                                    ICP_DEFAULT_FEE,
                                    recipient,
                                );
                                await window.reloadUser();
                                setUser(window.user);
                            } catch (e) {
                                alert(e);
                            }
                        }}
                    />
                </div>
                <div className="vcentered">
                    <div className="max_width_col"></div>
                    <code data-testid="icp-amount">
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
            </div>
            <div className="stands_out">
                <div className="vcentered">
                    <h2 className="max_width_col">Credits</h2>
                    <ButtonWithLoading
                        classNameArg="active"
                        onClick={async () => {
                            const maxKilos =
                                window.backendCache.config
                                    .max_credits_mint_kilos;
                            const kilo_credits = parseInt(
                                prompt(
                                    "Enter the number of 1000s of credits to mint " +
                                        `(max: ${maxKilos})`,
                                    "1",
                                ) || "",
                            );
                            if (Number(kilo_credits) > maxKilos) {
                                alert(
                                    `You can't mint more than ${
                                        1000 * maxKilos
                                    } credits at once.`,
                                );
                                return;
                            }
                            if (isNaN(kilo_credits)) {
                                return;
                            }
                            const { e8s_for_one_xdr } =
                                window.backendCache.stats;
                            const amount =
                                Number(e8s_for_one_xdr) * kilo_credits +
                                ICP_DEFAULT_FEE;
                            const response: any = await window.api.icp_transfer(
                                user.account,
                                amount,
                            );
                            if ("Err" in response) {
                                alert(
                                    `Couldn't transfer ICP for minting. Make sure you have at least ${tokens(
                                        amount,
                                        8,
                                    )} ICP on your wallet and try again.`,
                                );
                            }
                            const result: any = await mintCredits(
                                Math.max(1, kilo_credits),
                            );
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
                        label="MINT"
                    />
                </div>
                <div className="vcentered">
                    <div className="max_width_col"></div>
                    <code
                        className="xx_large_text"
                        data-testid="credits-amount"
                    >
                        {user.cycles.toLocaleString()}
                    </code>
                </div>
            </div>
            <div className="stands_out">
                <div className="vcentered">
                    <h2 className="max_width_col">{token_symbol}</h2>
                    <ButtonWithLoading
                        label="TRANSFER"
                        onClick={async () => {
                            await icrcTransfer(
                                Principal.fromText(CANISTER_ID),
                                token_symbol,
                                token_decimals,
                                transaction_fee,
                            );
                            await window.reloadUser();
                            setUser(window.user);
                        }}
                    />
                </div>
                <div className="vcentered">
                    <div className="max_width_col"></div>
                    <code className="xx_large_text">
                        {tokenBalance(user.balance)}
                    </code>
                </div>
                <hr />
                <h2>Latest Transactions</h2>
                <TransactionsView
                    principal={user.principal}
                    hideUserInfo={true}
                    heartbeat={new Date()}
                />
            </div>
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
