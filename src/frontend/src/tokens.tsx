import {
    bigScreen,
    ButtonWithLoading,
    CopyToClipboard,
    HeadBar,
    Loading,
    NotFound,
    percentage,
    timeAgo,
    token,
    tokenBalance,
    UserLink,
    XDR_TO_USD,
} from "./common";
import * as React from "react";
import { UserId, Transaction, User } from "./types";
import { Principal } from "@dfinity/principal";
import {
    IcrcAccount,
    decodeIcrcAccount,
    encodeIcrcAccount,
} from "@dfinity/ledger";
import { Content } from "./content";

type Balances = [IcrcAccount, number, UserId][];

const accToIcrcAcc = ({
    owner,
    subaccount,
}: {
    owner: string;
    subaccount: number[];
}): IcrcAccount => {
    return {
        owner: Principal.fromText(owner),
        subaccount: Uint8Array.from(subaccount || []),
    };
};

export const Tokens = () => {
    const [status, setStatus] = React.useState(0);
    const [timer, setTimer] = React.useState<any>(null);
    const [searchValue, setSearchValue] = React.useState("");
    const [query, setQuery] = React.useState("");
    const [balances, setBalances] = React.useState([] as Balances);
    const [balPage, setBalPage] = React.useState(0);
    const [holder, setHolder] = React.useState(-1);

    const loadBalances = async () => {
        const balances = await window.api.query<Balances>("balances");
        if (!balances || balances.length == 0) {
            setStatus(-1);
            return;
        }
        setStatus(1);
        balances.sort((a, b) => Number(b[1]) - Number(a[1]));
        setBalances(balances);
    };

    React.useEffect(() => {
        loadBalances();
    }, []);

    const mintedSupply = balances.reduce((acc, balance) => acc + balance[1], 0);
    const heldByUsers = balances.reduce(
        (acc, [_0, balance, userId]) => (userId == null ? acc : acc + balance),
        0,
    );
    const { total_supply, proposal_approval_threshold, transaction_fee } =
        window.backendCache.config;
    const balanceAmounts = balances
        .filter(([_0, _1, userId]) => !isNaN(userId))
        .map(([_, balance]) => balance);
    balanceAmounts.sort((a, b) => b - a);
    const balancesTotal = balanceAmounts.length;
    let vp = 0;
    while (
        balanceAmounts.length > 0 &&
        (vp / mintedSupply) * 100 < proposal_approval_threshold
    ) {
        vp += balanceAmounts.shift() || 0;
    }
    const userToPrincipal = balances.reduce(
        (acc, balance) => {
            const userName = window.backendCache.users[balance[2]];
            if (userName)
                acc[userName.toLowerCase()] = balance[0].owner.toString();
            return acc;
        },
        {} as { [name: string]: string },
    );
    const { e8s_for_one_xdr, e8s_revenue_per_1k } = window.backendCache.stats;
    const holders = balances.length;

    switch (status) {
        case 0:
            return <Loading />;
        case -1:
            return <NotFound />;
    }
    let searchedPrincipal;
    try {
        searchedPrincipal = Principal.fromText(
            userToPrincipal[query.toLowerCase()] || query,
        ).toString();
    } catch (_) {}
    return (
        <>
            <HeadBar title="TOKENS" shareLink="tokens" />
            <div className="spaced">
                <div className="dynamic_table vertically_spaced">
                    <div className="db_cell">
                        CIRCULATING<code>{token(mintedSupply)}</code>
                    </div>
                    <div className="db_cell">
                        MAXIMUM<code>{token(total_supply)}</code>
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
                                XDR_TO_USD
                            ).toLocaleString()}
                        </code>
                    </div>
                    <div className="db_cell">
                        MINTING RATIO
                        <code>
                            {window.backendCache.stats.minting_ratio}
                            :1
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
                <div className="row_container bottom_spaced">
                    {balances.slice(0, 100).map((b) => (
                        <div
                            key={b[0].owner.toString()}
                            style={{
                                height: "5em",
                                width: percentage(b[1], mintedSupply),
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
                        {balances.slice(0, (balPage + 1) * 25).map((b) => (
                            <tr key={b[0].owner.toString()}>
                                <td style={{ textAlign: "left" }}>
                                    {showPrincipal(b[0].owner.toString())}
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
                <div style={{ display: "flex", justifyContent: "center" }}>
                    <ButtonWithLoading
                        classNameArg="active"
                        onClick={async () => setBalPage(balPage + 1)}
                        label="MORE"
                    />
                </div>
                <hr />
                <h2>Latest transactions</h2>
                <div className="row_container">
                    <input
                        id="search_field"
                        className="max_width_col"
                        type="search"
                        placeholder="Search for user name or principal..."
                        value={searchValue}
                        onChange={(event) => {
                            clearTimeout(timer as unknown as any);
                            setSearchValue(event.target.value);
                            setTimer(
                                setTimeout(
                                    () => setQuery(event.target.value),
                                    300,
                                ),
                            );
                        }}
                    />
                </div>
                <TransactionsView principal={searchedPrincipal} />
            </div>
        </>
    );
};

export const TransactionsView = ({
    principal,
    prime,
    heartbeat,
}: {
    principal?: string;
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
        if (!principal) return;
        const profile = await window.api.query<User>("user", [principal]);
        if (!profile) {
            return;
        }
        setIdentifiedUser(profile);
    };

    const loadTransactions = async () => {
        setLoading(true);
        const acc = decodeIcrcAccount(
            principal || Principal.anonymous().toString(),
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
            principal && txPage == 0 ? txs : transactions.concat(txs),
        );
        setLoading(false);
    };

    React.useEffect(() => {
        loadTransactions();
        loadUser();
    }, [txPage, principal, heartbeat]);

    if (loading) return <Loading />;

    return (
        <>
            {principal && prime && (
                <HeadBar
                    title={
                        <>
                            TRANSACTIONS OF{" "}
                            <CopyToClipboard
                                value={principal}
                                displayMap={(value) =>
                                    value.split("-")[0].toUpperCase()
                                }
                            />
                        </>
                    }
                    shareLink={`transactions/${principal}`}
                />
            )}
            {identifiedUser && (
                <div className="stands_out top_spaced">
                    <h2 className="larger_text ">
                        User <UserLink id={identifiedUser.id} />
                    </h2>
                    <Content value={identifiedUser.about} />
                </div>
            )}
            <div className="spaced">
                <Transactions transactions={transactions} />
            </div>
            {!noMoreData && (
                <div
                    style={{
                        display: "flex",
                        justifyContent: "center",
                    }}
                >
                    <ButtonWithLoading
                        classNameArg="active"
                        onClick={async () => setTxPage(txPage + 1)}
                        label="MORE"
                    />
                </div>
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
                    <CopyToClipboard
                        value={encodeIcrcAccount(accToIcrcAcc(tx.from))}
                        displayMap={(id) =>
                            id in knownAddresses ? knownAddresses[id] : id
                        }
                    />
                )}
                <hr />
                TO
                <CopyToClipboard
                    value={encodeIcrcAccount(accToIcrcAcc(tx.to))}
                />
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
                        {showPrincipal(encodeIcrcAccount(accToIcrcAcc(t.from)))}
                    </td>
                    <td style={{ textAlign: "center" }}>
                        {showPrincipal(encodeIcrcAccount(accToIcrcAcc(t.to)))}
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

const showPrincipal = (principal: string) => (
    <a className="monospace" href={`#/transactions/${principal}`}>
        {principal in knownAddresses
            ? knownAddresses[principal]
            : principal == "2vxsx-fae"
            ? "🌱"
            : principal.split("-")[0]}
    </a>
);

const knownAddresses: { [key: string]: string } = {
    "opl73-raaaa-aaaag-qcunq-cai": "ICPSwap",
};
