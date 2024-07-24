import {
    bigScreen,
    ButtonWithLoading,
    CopyToClipboard,
    HeadBar,
    Loading,
    MoreButton,
    NotFound,
    parseNumber,
    percentage,
    shortenAccount,
    timeAgo,
    token,
    TokenBalance,
    tokenBalance,
    tokenBase,
    tokens,
    USD_PER_XDR,
} from "./common";
import * as React from "react";
import { UserId, Transaction, User, Account, Auction } from "./types";
import { Principal } from "@dfinity/principal";
import { decodeIcrcAccount, encodeIcrcAccount } from "@dfinity/ledger-icrc";
import { Content } from "./content";
import { CANISTER_ID } from "./env";
import { UserLink } from "./user_resolve";

type Balances = [Account, number, UserId][];

export const Tokens = () => {
    const [status, setStatus] = React.useState(0);
    const [balances, setBalances] = React.useState([] as Balances);
    const [balPage, setBalPage] = React.useState(0);
    const [holder, setHolder] = React.useState(-1);

    const loadData = async () => {
        const [balances] = await Promise.all([
            window.api.query<Balances>("balances"),
        ]);

        if (!balances || balances.length == 0) {
            setStatus(-1);
            return;
        }
        setStatus(1);
        balances.sort((a, b) => Number(b[1]) - Number(a[1]));
        setBalances(balances);
    };

    React.useEffect(() => {
        loadData();
    }, []);

    const mintedSupply = balances.reduce((acc, balance) => acc + balance[1], 0);
    const top100Supply = balances
        .slice(0, 100)
        .reduce((acc, balance) => acc + balance[1], 0);
    const heldByUsers = balances.reduce(
        (acc, [_0, balance, userId]) => (userId == null ? acc : acc + balance),
        0,
    );
    const { maximum_supply, proposal_approval_threshold, transaction_fee } =
        window.backendCache.config;
    const uniqueUsers = balances.reduce(
        (acc, [_, balance, userId]) => {
            if (userId != null && !isNaN(userId))
                acc[userId] = (acc[userId] || 0) + balance;
            return acc;
        },
        {} as { [id: UserId]: number },
    );
    const balanceAmounts = Object.entries(uniqueUsers).map(([_, balance]) =>
        Number(balance),
    );
    balanceAmounts.sort((a, b) => b - a);
    const balancesTotal = balanceAmounts.length;
    let vp = 0;
    while (
        balanceAmounts.length > 0 &&
        (vp / mintedSupply) * 100 < proposal_approval_threshold
    ) {
        vp += balanceAmounts.shift() || 0;
    }
    const { e8s_for_one_xdr, e8s_revenue_per_1k } = window.backendCache.stats;
    const holders = balances.length;

    if (status == 0) return <Loading />;

    return (
        <>
            <HeadBar title="TOKENS" shareLink="tokens" />
            <div className="spaced">
                <div className="dynamic_table vertically_spaced">
                    <div className="db_cell">
                        CIRCULATING<code>{token(mintedSupply)}</code>
                    </div>
                    <div className="db_cell">
                        MAXIMUM<code>{token(maximum_supply)}</code>
                    </div>
                    <div className="db_cell">
                        HOLDERS<code>{holders}</code>
                    </div>
                    <div className="db_cell">
                        HELD BY USERS<code>{token(heldByUsers)}</code>
                    </div>
                    <div className="db_cell">
                        WEEKLY REVENUE / 10K
                        <code>
                            $
                            {(
                                ((Number(e8s_revenue_per_1k) * 10) /
                                    Number(e8s_for_one_xdr)) *
                                USD_PER_XDR
                            ).toLocaleString()}
                        </code>
                    </div>
                    <div className="db_cell">
                        APPROVAL THRESHOLD
                        <code>{proposal_approval_threshold}%</code>
                    </div>
                    <div className="db_cell">
                        NAKAMOTO COEFF.
                        <code>{balancesTotal - balanceAmounts.length}</code>
                    </div>
                    <div className="db_cell">
                        VOLUME 24H
                        <code>
                            {token(window.backendCache.stats.volume_day)}
                        </code>
                    </div>
                    <div className="db_cell">
                        VOLUME 7D
                        <code>
                            {token(window.backendCache.stats.volume_week)}
                        </code>
                    </div>
                    <div className="db_cell">
                        TRANSACTION FEE
                        <code>
                            {Number(
                                transaction_fee /
                                    Math.pow(
                                        10,
                                        window.backendCache.config
                                            .token_decimals,
                                    ),
                            ).toLocaleString()}
                        </code>
                    </div>
                    <div className="db_cell">
                        TOTAL FEES BURNED
                        <code>
                            {token(window.backendCache.stats.fees_burned)}
                        </code>
                    </div>
                </div>
                <h2>Top 100 token holders</h2>
                <div className="bottom_spaced" style={{ display: "flex" }}>
                    {balances.slice(0, 100).map((b, i) => (
                        <div
                            key={i}
                            style={{
                                height: "5em",
                                width: percentage(b[1], top100Supply),
                                background:
                                    holder == b[2]
                                        ? "black"
                                        : genColor(b[0].owner.toString()),
                            }}
                            onMouseOver={() => setHolder(b[2])}
                            onClick={() => setHolder(b[2])}
                        ></div>
                    ))}
                </div>
                Holder: {holder < 0 ? "none" : <UserLink id={holder} />}
                <table style={{ width: "100%" }}>
                    <thead className={bigScreen() ? undefined : "small_text"}>
                        <tr>
                            <th style={{ textAlign: "left" }}>Principal</th>
                            <th style={{ textAlign: "right" }}>Balance</th>
                            <th style={{ textAlign: "right" }}>Share</th>
                            <th style={{ textAlign: "right" }}>User</th>
                        </tr>
                    </thead>
                    <tbody
                        style={{ textAlign: "right" }}
                        className={bigScreen() ? "" : "small_text"}
                    >
                        {balances.slice(0, (balPage + 1) * 25).map((b, i) => (
                            <tr key={i}>
                                <td style={{ textAlign: "left" }}>
                                    {showPrincipal(b[0])}
                                </td>
                                <td>
                                    <code>{token(b[1])}</code>
                                </td>
                                <td>{percentage(b[1], mintedSupply)}</td>
                                <td>
                                    <UserLink id={b[2]} />
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                <MoreButton callback={async () => setBalPage(balPage + 1)} />
                <hr />
                <Auction />
            </div>
            <hr />
            <div className="spaced">
                <h2>Latest transactions</h2>
            </div>
            <TransactionsView />
        </>
    );
};

const Auction = ({}) => {
    const [auction, setAuction] = React.useState<Auction>();
    const [internalAccount, setInternalAccount] = React.useState("");
    const [e8sPerToken, setE8sPerToken] = React.useState<string>("");
    const [bidSize, setBidSize] = React.useState<string>("");
    const [parsedE8sPerToken, setParsedE8sPerToken] = React.useState(0);
    const [parsedBidSize, setParsedBidSize] = React.useState(0);
    const [payment, setPayment] = React.useState(0);

    const { token_symbol, token_decimals } = window.backendCache.config;

    const loadData = async () => {
        const [auction, account] =
            (await window.api.query<[Auction, string]>("auction", [])) || [];
        if (!auction) return;
        auction.bids = auction.bids.reverse();
        setAuction(auction);
        setInternalAccount(account || "");
    };

    React.useEffect(() => {
        const e8s = (parseNumber(e8sPerToken || "0", 8) || 0) / tokenBase();
        const tokens = parseNumber(bidSize || "0", token_decimals) || 0;
        const volume = e8s * tokens;
        if (volume > 0) {
            setPayment(volume);
            setParsedBidSize(tokens);
            setParsedE8sPerToken(e8s);
        }
    }, [e8sPerToken, bidSize]);

    React.useEffect(() => {
        loadData();
    }, []);

    if (!auction) return null;

    return (
        <>
            <h2>Upcoming Auction</h2>
            <p>
                Amount: <code>{tokens(auction.amount, token_decimals)}</code>{" "}
                {token_symbol}
            </p>
            <p>
                This is the decentralized auction establishing the market price
                of {token_symbol}.
            </p>
            {window.user && (
                <div className="stands_out padded_rounded">
                    To participate in the auction, create a bid here.
                    <div className="column_container top_spaced">
                        <input
                            type="text"
                            value={e8sPerToken}
                            onChange={(e) => setE8sPerToken(e.target.value)}
                            placeholder={`ICP per 1 ${token_symbol}`}
                        />
                        <input
                            type="text"
                            value={bidSize}
                            onChange={(e) => setBidSize(e.target.value)}
                            className="top_half_spaced"
                            placeholder={`Number of ${token_symbol} tokens`}
                        />
                        {payment > 0 && (
                            <p className="top_spaced bottom_spaced">
                                Please transfer{" "}
                                <code>{tokens(payment, 8)}</code> ICP to
                                <br />
                                <br />
                                <CopyToClipboard
                                    value={internalAccount}
                                    displayMap={(account) =>
                                        bigScreen()
                                            ? account
                                            : shortenAccount(account)
                                    }
                                />
                                <br />
                                <br />
                                before creating a bid.
                            </p>
                        )}
                        <div className="row_container">
                            <ButtonWithLoading
                                classNameArg="top_spaced max_width_col right_half_spaced"
                                onClick={async () => {
                                    if (
                                        !confirm(
                                            "Your bid will be cancelled and the ICP funds will be moved to your wallet. Continue?",
                                        )
                                    )
                                        return;
                                    const response: any =
                                        await window.api.call("cancel_bid");
                                    if (!response) {
                                        alert("Error: call failed");
                                        return;
                                    }
                                    if ("Err" in response) {
                                        alert(`Error: ${response.Err}`);
                                        return;
                                    }
                                    await loadData();
                                }}
                                label="CANCEL MY BID"
                            />
                            <ButtonWithLoading
                                classNameArg="top_spaced active max_width_col left_half_spaced"
                                onClick={async () => {
                                    const response: any = await window.api.call(
                                        "create_bid",
                                        parsedBidSize,
                                        parsedE8sPerToken,
                                    );
                                    if (!response) {
                                        alert("Error: call failed");
                                        return;
                                    }
                                    if ("Err" in response) {
                                        alert(`Error: ${response.Err}`);
                                        return;
                                    }
                                    setE8sPerToken("");
                                    setBidSize("");
                                    await loadData();
                                }}
                                label="CREATE MY BID"
                            />
                        </div>
                    </div>
                </div>
            )}
            {auction.bids.length > 0 && (
                <>
                    <h3>Current bids</h3>
                    <ul>
                        {auction?.bids.map((bid) => (
                            <li key={bid.user}>
                                <code>
                                    {tokens(bid.e8s_per_token * tokenBase(), 8)}
                                </code>{" "}
                                ICP per token for{" "}
                                <code>
                                    {tokens(bid.amount, token_decimals)}
                                </code>{" "}
                                {token_symbol} by <UserLink id={bid.user} />
                            </li>
                        ))}
                    </ul>
                </>
            )}
        </>
    );
};

export const TransactionsView = ({
    icrcAccount,
    prime,
    heartbeat,
}: {
    icrcAccount?: string;
    prime?: boolean;
    heartbeat?: any;
}) => {
    const [noMoreData, setNoMoreData] = React.useState(false);
    const [loading, setLoading] = React.useState(false);
    const [identifiedUser, setIdentifiedUser] = React.useState<User | null>(
        null,
    );
    const [transactions, setTransactions] = React.useState(
        [] as [number, Transaction][],
    );
    const [txPage, setTxPage] = React.useState(0);

    const loadUser = async () => {
        if (!icrcAccount) return;
        const profile = await window.api.query<User>("user", [icrcAccount]);
        if (!profile) {
            return;
        }
        setIdentifiedUser(profile);
    };

    const loadTransactions = async () => {
        setLoading(true);
        const acc = decodeIcrcAccount(
            icrcAccount || Principal.anonymous().toString(),
        );
        const txs =
            (await window.api.query<[number, Transaction][]>(
                "transactions",
                txPage,
                acc.owner.toString(),
                Buffer.from(acc.subaccount || new Uint8Array(32)).toString(
                    "hex",
                ),
            )) || [];
        if (txs?.length == 0) {
            setNoMoreData(true);
        }
        setTransactions(
            icrcAccount && txPage == 0 ? txs : transactions.concat(txs),
        );
        setLoading(false);
    };

    React.useEffect(() => {
        loadTransactions();
        loadUser();
    }, [txPage, icrcAccount, heartbeat]);

    if (loading) return <Loading />;
    const { token_symbol, token_decimals } = window.backendCache.config;

    return (
        <>
            {icrcAccount && prime && (
                <>
                    <HeadBar
                        title={
                            <>
                                TRANSACTIONS OF{" "}
                                <CopyToClipboard
                                    value={icrcAccount}
                                    displayMap={(value) => {
                                        const [acc, subacc] = value.split(".");
                                        let result = (
                                            acc.split("-")[0] +
                                            (subacc
                                                ? `.${subacc.slice(0, 6)}`
                                                : "")
                                        ).toUpperCase();
                                        return result;
                                    }}
                                />
                            </>
                        }
                        shareLink={`transactions/${icrcAccount}`}
                    />
                    <div className="stands_out top_spaced">
                        {icrcAccount && (
                            <h2>
                                BALANCE:{" "}
                                <code>
                                    <TokenBalance
                                        ledgerId={Principal.fromText(
                                            CANISTER_ID,
                                        )}
                                        decimals={token_decimals}
                                        symbol={token_symbol}
                                        account={decodeIcrcAccount(icrcAccount)}
                                    />
                                </code>
                            </h2>
                        )}
                        {identifiedUser && (
                            <>
                                <h3 className="larger_text ">
                                    User{" "}
                                    <UserLink
                                        id={identifiedUser.id}
                                        name={identifiedUser.name}
                                    />
                                </h3>
                                <Content value={identifiedUser.about} />
                            </>
                        )}
                    </div>
                </>
            )}
            <div className="spaced">
                <Transactions transactions={transactions} />
            </div>
            {!noMoreData && (
                <MoreButton callback={async () => setTxPage(txPage + 1)} />
            )}
        </>
    );
};

export const TransactionView = ({ id }: { id: number }) => {
    const [status, setStatus] = React.useState(0);
    const [tx, setTransaction] = React.useState({} as Transaction);
    React.useEffect(() => {
        window.api.query("transaction", id).then((result: any) => {
            if ("Err" in result) {
                setStatus(-1);
                return;
            }
            setStatus(1);
            setTransaction(result.Ok);
        });
    }, []);
    if (status == 0) return <Loading />;
    if (status == -1) return <NotFound />;
    return (
        <div className="spaced no_overflow">
            <HeadBar
                title={
                    <>
                        TRANSACTION <code>#{id}</code>
                    </>
                }
                shareLink={`transaction/${id}`}
            />
            <div className="column_container">
                TIMESTAMP
                <code className="x_large_text">
                    {new Date(Number(tx.timestamp) / 1000000).toLocaleString()}
                </code>
                <hr />
                FROM
                {tx.from.owner == Principal.anonymous().toString() ? (
                    <code>MINTING ACCOUNT 🌱</code>
                ) : (
                    showPrincipal(tx.from, "long")
                )}
                <hr />
                TO
                {showPrincipal(tx.to, "long")}
                <hr />
                AMOUNT{" "}
                <code className="xx_large_text">{tokenBalance(tx.amount)}</code>
                <hr />
                FEE <code>{tokenBalance(tx.fee)}</code>
                <hr />
                {tx.memo && (
                    <>
                        {" "}
                        MEMO{" "}
                        <code>
                            {new TextDecoder("utf-8").decode(
                                new Uint8Array(tx.memo),
                            )}
                        </code>
                    </>
                )}
            </div>
        </div>
    );
};

const Transactions = ({
    transactions,
}: {
    transactions: [number, Transaction][];
}) => (
    <table style={{ width: "100%" }}>
        <thead
            style={{ textAlign: "right" }}
            className={bigScreen() ? undefined : "small_text"}
        >
            <tr>
                <th style={{ textAlign: "left" }}>ID</th>
                <th style={{ textAlign: "left" }}>Time</th>
                <th style={{ textAlign: "center" }}>From</th>
                <th style={{ textAlign: "center" }}>To</th>
                <th>#</th>
            </tr>
        </thead>
        <tbody
            style={{ textAlign: "right" }}
            className={bigScreen() ? undefined : "small_text"}
        >
            {transactions.map(([id, t]) => (
                <tr key={JSON.stringify(t)}>
                    <td style={{ textAlign: "left" }}>
                        <a href={`#/transaction/${id}`}>{id}</a>
                    </td>
                    <td style={{ textAlign: "left" }}>
                        {timeAgo(t.timestamp)}
                    </td>
                    <td style={{ textAlign: "center" }}>
                        {showPrincipal(t.from)}
                    </td>
                    <td style={{ textAlign: "center" }}>
                        {showPrincipal(t.to)}
                    </td>
                    <td>
                        <code>{tokenBalance(t.amount)}</code>
                    </td>
                </tr>
            ))}
        </tbody>
    </table>
);

const genColor = (val: string) => {
    let hash = 0;
    for (let i = 0; i < val.length; i++) {
        hash = val.charCodeAt(i) + ((hash << 5) - hash);
    }
    let color = "#";
    for (let i = 0; i < 3; i++) {
        let value = (hash >> (i * 8)) & 0xff;
        color += ("00" + value.toString(16)).substr(-2);
    }
    return color;
};

const showPrincipal = ({ owner, subaccount }: Account, long?: string) => {
    const icrcAccount = {
        owner: Principal.fromText(owner),
        subaccount: Uint8Array.from(subaccount || []),
    };
    let principal: string = encodeIcrcAccount(icrcAccount);
    return (
        <CopyToClipboard
            value={principal}
            displayMap={(principal) => (
                <a className="monospace" href={`#/transactions/${principal}`}>
                    {principal in knownAddresses
                        ? knownAddresses[principal]
                        : principal == "2vxsx-fae"
                        ? "🌱"
                        : long
                        ? principal
                        : principal.split("-")[0]}
                </a>
            )}
        />
    );
};

const knownAddresses: { [key: string]: string } = {
    "cetrr-jaaaa-aaaak-afgxq-cai": "BEACON",
    "opl73-raaaa-aaaag-qcunq-cai": "ICPSwap",
};
