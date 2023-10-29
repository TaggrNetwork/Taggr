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
    IcpAccountLink,
} from "./common";
import * as React from "react";
import { Transactions } from "./tokens";
import { LoginMasks, logout, SeedPhraseForm } from "./logins";
import { Ed25519KeyIdentity } from "@dfinity/identity";
import { Transaction } from "./types";

type Invoice = { paid: boolean; e8s: BigInt; account: number[] };

const Welcome = () => {
    const [invoice, setInvoice] = React.useState<Invoice>();
    const [loadingInvoice, setLoadingInvoice] = React.useState(false);
    const [seedPhraseConfirmed, setSeedPhraseConfirmed] = React.useState(false);

    const checkPayment = async () => {
        setLoadingInvoice(true);
        const result = await window.api.call<any>("mint_cycles", 0);
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
                                    you need "cycles". Cycles are app-internal
                                    tokens which you spend as a "gas" while
                                    using the app. You can mint cycles yourself
                                    or you can use an invite pre-charged with
                                    cycles created by another{" "}
                                    {window.backendCache.config.name} user. Ask
                                    around on socials for an invite or keep
                                    reading to get onboard faster.
                                </p>
                                <p>
                                    To mint cycles, you need to transfer a small
                                    amount of ICP to an account controlled by
                                    the {window.backendCache.config.name}{" "}
                                    canister. You get <code>1000</code> cycles
                                    for as little as <code>~1.3 USD</code>{" "}
                                    (corresponds to 1{" "}
                                    <a href="https://en.wikipedia.org/wiki/Special_drawing_rights">
                                        XDR
                                    </a>
                                    ). Before you mint cycles, make sure you
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
                                Checking the balance... This can take up to a
                                minute.
                                <Loading classNameArg="vertically_spaced" />
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
                                            MINT CYCLES
                                        </button>
                                    </>
                                )}
                                {invoice && (
                                    <>
                                        {invoice.paid && (
                                            <div>
                                                <h2>CYCLES MINTED! ✅</h2>
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
                                            <div className="stands_out">
                                                Please transfer&nbsp;
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
                                                cycles.
                                                <br />
                                                <br />
                                                (Larger transfers will mint a
                                                proportionally larger number of
                                                cycles.)
                                                <br />
                                                <br />
                                                <button
                                                    className="active"
                                                    onClick={checkPayment}
                                                >
                                                    CHECK BALANCE
                                                </button>
                                            </div>
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

const shortenAccount = (account: string) => {
    return `${account.slice(0, 6)}..${account.substr(account.length - 6)}`;
};
const shortenPrincipal = (principal: string) => {
    const parts = principal.split("-");
    return `${parts[0]}-...-${parts[parts.length - 1]}`;
};

export const Wallet = () => {
    const [user, setUser] = React.useState(window.user);
    const mintCycles = async (kilo_cycles: number) =>
        await window.api.call("mint_cycles", kilo_cycles);
    const [transactions, setTransactions] = React.useState(
        [] as [number, Transaction][],
    );

    const loadTransactions = async () => {
        if (!window.user) return;
        const txs = await window.api.query<any>(
            "transactions",
            0,
            window.user.principal,
        );
        setTransactions(txs);
    };

    React.useEffect(() => {
        loadTransactions();
    }, []);

    if (!user) return <Welcome />;
    let { token_symbol, token_decimals, name } = window.backendCache.config;

    return (
        <>
            <HeadBar title="WALLET" shareLink="wallets" />
            {user.cycles <= 200 && (
                <div className="banner">
                    You are low on cycles! Please transfer some ICP to your
                    account displayed below and press the MINT button.
                </div>
            )}
            <div className="stands_out">
                <div className="vcentered">
                    <h2 className="max_width_col">ICP</h2>
                    <ButtonWithLoading
                        label="TRANSFER"
                        onClick={async () => {
                            const amount = prompt(
                                "Enter the amount (fee: 0.0001 ICP)",
                            );
                            if (!amount) return;
                            const recipient = prompt(
                                "Enter the recipient address",
                            );
                            if (!recipient) return;
                            if (
                                !confirm(
                                    `You are transferring\n\n${amount} ICP\n\nto\n\n${recipient}`,
                                )
                            )
                                return;
                            let result = await window.api.call<any>(
                                "transfer_icp",
                                recipient,
                                amount,
                            );
                            await window.reloadUser();
                            setUser(window.user);
                            if ("Err" in result) {
                                alert(`Error: ${result.Err}`);
                                return;
                            }
                        }}
                    />
                </div>
                <div className="vcentered">
                    <code className="max_width_col">
                        <CopyToClipboard
                            value={user.account}
                            displayMap={(val) => (
                                <IcpAccountLink
                                    label={bigScreen() ? val : val.slice(0, 16)}
                                    address={user.account}
                                />
                            )}
                        />
                    </code>
                    <code data-testid="icp-amount">
                        <ICPAccountBalance
                            heartbeat={new Date()}
                            address={user.account}
                            units={false}
                            decimals={4}
                        />
                    </code>
                </div>
                <div className="vcentered top_spaced">
                    <div className="max_width_col">Rewards</div>
                    <code className="accent">
                        {icpCode(user.treasury_e8s, 4, false)}
                    </code>
                </div>
            </div>
            <div className="stands_out">
                <div className="vcentered">
                    <h2 className="max_width_col">{name} Cycles</h2>
                    <ButtonWithLoading
                        classNameArg="active"
                        onClick={async () => {
                            const kilo_cycles = parseInt(
                                prompt(
                                    "Enter the number of 1000s of cycles to mint",
                                    "1",
                                ) || "",
                            );
                            if (isNaN(kilo_cycles)) {
                                return;
                            }
                            const result: any = await mintCycles(
                                Math.max(1, kilo_cycles),
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
                    <code className="xx_large_text" data-testid="cycles-amount">
                        {user.cycles.toLocaleString()}
                    </code>
                </div>
            </div>
            <div className="stands_out">
                <div className="vcentered">
                    <h2 className="max_width_col">${token_symbol} Tokens</h2>
                    <ButtonWithLoading
                        label="TRANSFER"
                        onClick={async () => {
                            const amount = prompt(
                                `Enter the amount (fee: ${
                                    1 / Math.pow(10, token_decimals)
                                } ${token_symbol})`,
                            );
                            if (!amount) return;
                            const recipient = prompt(
                                "Enter the recipient principal",
                            );
                            if (!recipient) return;
                            if (
                                !confirm(
                                    `You are transferring\n\n${amount} ${token_symbol}\n\nto\n\n${recipient}`,
                                )
                            )
                                return;
                            let result: any = await window.api.call(
                                "transfer_tokens",
                                recipient,
                                amount,
                            );
                            if ("Err" in result) {
                                alert(`Error: ${result.Err}`);
                                return;
                            }
                            await window.reloadUser();
                            setUser(window.user);
                        }}
                    />
                </div>
                <div className="vcentered">
                    <code className="max_width_col">
                        <CopyToClipboard
                            value={user.principal}
                            displayMap={(val) =>
                                bigScreen() ? val : val.split("-")[0]
                            }
                        />
                    </code>
                    <code className="xx_large_text">
                        {tokenBalance(user.balance)}
                    </code>
                </div>
                <hr />
                <h2>Latest Transactions</h2>
                <Transactions transactions={transactions} />
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
