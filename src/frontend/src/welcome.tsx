import * as React from "react";
import {
    shortenAccount,
    CopyToClipboard,
    HeadBar,
    Loading,
    hex,
    bigScreen,
    USD_PER_XDR,
    signOut,
    showPopUp,
    ButtonWithLoading,
} from "./common";

type ICPInvoice = {
    paid: boolean;
    e8s: BigInt;
    account: number[];
};

const shortenPrincipal = (principal: string) => {
    const parts = principal.split("-");
    return `${parts[0]}-...-${parts[parts.length - 1]}`;
};

export const Welcome = () => {
    const [icpInvoice, setICPInvoice] = React.useState<ICPInvoice | null>();
    const [loadingInvoice, setLoadingInvoice] = React.useState(false);

    // If an existing user gets here (e.g. by using sign up), just redirect them to the landing page.
    if (window.user) {
        location.href = "#/";
    }

    const checkICPPayment = async () => {
        setLoadingInvoice(true);
        const result = await window.api.call<any>("mint_credits_with_icp", 0);
        if ("Err" in result) {
            showPopUp("error", result.Err);
            return;
        }
        setICPInvoice(result.Ok);
        setLoadingInvoice(false);
    };

    const logOutButton = (
        <ButtonWithLoading onClick={signOut} label="SIGN OUT" />
    );

    const { name, blob_cost, post_cost } = window.backendCache.config;

    const invoice = icpInvoice ? { paid: icpInvoice.paid } : null;

    return (
        <>
            <HeadBar title={"WELCOME!"} shareLink="welcome" />
            <div className="spaced">
                {(!invoice || !invoice.paid) && (
                    <div className="bottom_spaced">
                        <h2>New user detected</h2>
                        Your {name} principal:{" "}
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
                            To join {name} you need "credits". Credits are
                            app-internal tokens which you spend as a "gas" while
                            using the app. You can mint credits yourself or you
                            can use an invite pre-charged with credits created
                            by another {name} user. Ask around on socials for an
                            invite or keep reading to get on board faster.
                        </p>
                        <p>
                            To mint credits, you need to transfer a small amount
                            of ICP to an account controlled by the {name}{" "}
                            canister. You get <code>1000</code> credits for as
                            little as <code>~{USD_PER_XDR} USD</code>{" "}
                            (corresponds to 1{" "}
                            <a href="https://en.wikipedia.org/wiki/Special_drawing_rights">
                                XDR
                            </a>
                            ). These credits are enough to create{" "}
                            <code>{1000 / post_cost}</code> text posts or{" "}
                            <code>{1000 / blob_cost}</code> posts with images
                            that will be stored on-chain without any expiration
                            date.
                        </p>
                        <p>
                            Before you mint credits, make sure you understand{" "}
                            <a href="#/whitepaper">
                                how {window.backendCache.config.name} works
                            </a>
                            !
                        </p>
                        {!invoice && !loadingInvoice && (
                            <p>Ready to mint? Continue below!</p>
                        )}
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
                            <div className="column_container vertically_spaced">
                                <ButtonWithLoading
                                    classNameArg="active bottom_spaced"
                                    onClick={checkICPPayment}
                                    label="MINT CREDITS WITH ICP"
                                />
                                {logOutButton}
                            </div>
                        )}
                        {invoice && (
                            <>
                                {invoice.paid && (
                                    <div>
                                        <h2>CREDITS MINTED! ✅</h2>
                                        <p>
                                            You can create a user account now.
                                        </p>
                                        <button
                                            className="active top_spaced"
                                            onClick={() =>
                                                (location.href = "/#/settings")
                                            }
                                        >
                                            CREATE USER
                                        </button>
                                    </div>
                                )}
                                {!invoice.paid && icpInvoice && (
                                    <>
                                        To mint <code>1000</code> credits,
                                        please make the following payment:
                                        <p className="stands_out">
                                            Transfer at least&nbsp;
                                            <CopyToClipboard
                                                testId="invoice-amount"
                                                value={(
                                                    Number(icpInvoice.e8s) / 1e8
                                                ).toString()}
                                            />
                                            &nbsp;ICP to account
                                            <br />
                                            <CopyToClipboard
                                                value={hex(icpInvoice.account)}
                                                displayMap={shortener}
                                                testId="account-to-transfer-to"
                                            />
                                            <br />
                                            <br />
                                            If you transfer a larger amount, the
                                            surplus will end up in your ICP
                                            wallet after you have created the
                                            user account.
                                        </p>
                                        <br />
                                        <div className="column_container">
                                            <button
                                                className="active bottom_spaced large_text"
                                                onClick={checkICPPayment}
                                            >
                                                CHECK BALANCE
                                            </button>
                                            <button
                                                className="bottom_spaced large_text"
                                                onClick={() => {
                                                    setICPInvoice(null);
                                                }}
                                            >
                                                CHANGE PAYMENT
                                            </button>
                                            {logOutButton}
                                        </div>
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

const shortener = (account: string) =>
    bigScreen() ? account : shortenAccount(account);
