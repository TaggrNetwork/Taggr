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
} from "./common";

type ICPInvoice = {
    paid: boolean;
    e8s: BigInt;
    account: number[];
};

type BTCInvoice = {
    paid: boolean;
    sats: number;
    fee: number;
    address: string;
};

const shortenPrincipal = (principal: string) => {
    const parts = principal.split("-");
    return `${parts[0]}-...-${parts[parts.length - 1]}`;
};

export const Welcome = () => {
    const [icpInvoice, setICPInvoice] = React.useState<ICPInvoice | null>();
    const [btcInvoice, setBTCInvoice] = React.useState<BTCInvoice | null>();
    const [payment, setPayment] = React.useState("");
    const [loadingInvoice, setLoadingInvoice] = React.useState(false);

    if (window.user) {
        location.href = "#/";
    }

    const checkICPPayment = async () => {
        setLoadingInvoice(true);
        setPayment("icp");
        const result = await window.api.call<any>("mint_credits_with_icp", 0);
        if ("Err" in result) {
            showPopUp("error", result.Err);
            return;
        }
        setICPInvoice(result.Ok);
        setLoadingInvoice(false);
    };

    const checkBTCPayment = async () => {
        setLoadingInvoice(true);
        setPayment("btc");
        const result = await window.api.call<any>("mint_credits_with_btc", 0);
        if ("Err" in result) {
            alert(`Error: ${result.Err}`);
            return;
        }
        setBTCInvoice(result.Ok);
        setLoadingInvoice(false);
    };

    const logOutButton = (
        <button className="right_spaced" onClick={signOut}>
            SIGN OUT
        </button>
    );

    const { name, blob_cost, post_cost } = window.backendCache.config;

    const invoice =
        icpInvoice || btcInvoice
            ? { paid: icpInvoice?.paid || btcInvoice?.paid }
            : null;

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
                            of Bitcoin or ICP to an account controlled by the{" "}
                            {name} canister. You get <code>1000</code> credits
                            for as little as <code>~{USD_PER_XDR} USD</code>{" "}
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
                            <>
                                {logOutButton}
                                <button
                                    className="active vertically_spaced left_spaced"
                                    onClick={checkICPPayment}
                                >
                                    MINT CREDITS WITH ICP
                                </button>
                                <button
                                    className="active vertically_spaced left_spaced"
                                    onClick={checkBTCPayment}
                                >
                                    MINT CREDITS WITH BITCOIN
                                </button>
                            </>
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
                                {!invoice.paid && (
                                    <>
                                        To mint <code>1000</code> credits,
                                        please make the following payment:
                                        {payment == "btc" && btcInvoice && (
                                            <p className="stands_out">
                                                Transfer at least&nbsp;
                                                <CopyToClipboard
                                                    testId="invoice-amount-btc"
                                                    value={Number(
                                                        btcInvoice.sats +
                                                            btcInvoice.fee,
                                                    ).toString()}
                                                />
                                                &nbsp;Sats (
                                                <code>{btcInvoice.fee}</code>{" "}
                                                Sats tx. fees already included)
                                                to account
                                                <br />
                                                <CopyToClipboard
                                                    value={btcInvoice.address}
                                                    displayMap={shortener}
                                                    testId="account-to-transfer-to"
                                                />
                                                <br />
                                                and wait for at least one
                                                confirmation!
                                                <br />
                                                <br />
                                                If you transfer a larger amount,
                                                a proportionally larger number
                                                of credits will be minted.
                                            </p>
                                        )}
                                        {payment == "icp" && icpInvoice && (
                                            <p className="stands_out">
                                                Transfer at least&nbsp;
                                                <CopyToClipboard
                                                    testId="invoice-amount"
                                                    value={(
                                                        Number(icpInvoice.e8s) /
                                                        1e8
                                                    ).toString()}
                                                />
                                                &nbsp;ICP to account
                                                <br />
                                                <CopyToClipboard
                                                    value={hex(
                                                        icpInvoice.account,
                                                    )}
                                                    displayMap={shortener}
                                                    testId="account-to-transfer-to"
                                                />
                                                <br />
                                                <br />
                                                If you transfer a larger amount,
                                                the surplus will end up in your
                                                ICP wallet after you have
                                                created the user account.
                                            </p>
                                        )}
                                        <br />
                                        <br />
                                        {logOutButton}
                                        <button
                                            className="right_spaced"
                                            onClick={() => {
                                                setBTCInvoice(null);
                                                setICPInvoice(null);
                                            }}
                                        >
                                            CHANGE PAYMENT
                                        </button>
                                        <button
                                            className="active"
                                            onClick={
                                                payment == "icp"
                                                    ? checkICPPayment
                                                    : checkBTCPayment
                                            }
                                        >
                                            CHECK BALANCE
                                        </button>
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
