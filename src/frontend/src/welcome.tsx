import * as React from "react";
import { LoginMasks } from "./authentication";
import {
    shortenAccount,
    CopyToClipboard,
    HeadBar,
    Loading,
    hex,
    bigScreen,
    USD_PER_XDR,
    HASH_ITERATIONS,
    hash,
    signOut,
    SeedPhraseForm,
    showPopUp,
} from "./common";
import { Ed25519KeyIdentity } from "@dfinity/identity";

type Invoice = { paid: boolean; e8s: BigInt; account: number[] };

const shortenPrincipal = (principal: string) => {
    const parts = principal.split("-");
    return `${parts[0]}-...-${parts[parts.length - 1]}`;
};

export const Welcome = () => {
    const [invoice, setInvoice] = React.useState<Invoice>();
    const [loadingInvoice, setLoadingInvoice] = React.useState(false);
    const [seedPhraseConfirmed, setSeedPhraseConfirmed] = React.useState(false);

    const checkPayment = async () => {
        setLoadingInvoice(true);
        const result = await window.api.call<any>("mint_credits", 0);
        setLoadingInvoice(false);
        if ("Err" in result) {
            showPopUp("error", result.Err);
            return;
        }
        setInvoice(result.Ok);
    };

    const seedphraseConfirmationRequired =
        !!localStorage.getItem("SEED_PHRASE") && !seedPhraseConfirmed;
    const logOutButton = (
        <button className="right_spaced" onClick={signOut}>
            SIGN OUT
        </button>
    );

    return (
        <>
            <HeadBar title={"WELCOME!"} shareLink="welcome" />
            <div className="spaced">
                {seedphraseConfirmationRequired && (
                    <>
                        <h2>New user detected</h2>
                        <SeedPhraseForm
                            classNameArg=""
                            confirmationRequired={seedphraseConfirmationRequired}
                            callback={async (seedphrase: string) => {
                                const seed = await hash(
                                    seedphrase,
                                    HASH_ITERATIONS,
                                );
                                let identity =
                                    Ed25519KeyIdentity.generate(seed);
                                if (
                                    identity.getPrincipal().toString() !=
                                    window.getPrincipalId()
                                ) {
                                    showPopUp(
                                        "error",
                                        "The seed phrase does not match! Please log-out and try again.",
                                        5,
                                    );
                                    return;
                                } else setSeedPhraseConfirmed(true);
                            }}
                        />
                    </>
                )}
                {!seedphraseConfirmationRequired && (
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
