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
} from "./common";
import * as React from "react";
import { UserId, Transaction } from "./types";

type Balances = [string, number, UserId][];

export const Tokens = () => {
    const [status, setStatus] = React.useState(0);
    const [balances, setBalances] = React.useState([] as Balances);
    const [term, setTerm] = React.useState("");
    const [noMoreData, setNoMoreData] = React.useState(false);
    const [transactions, setTransactions] = React.useState(
        [] as [number, Transaction][]
    );
    const [txPage, setTxPage] = React.useState(0);
    const [balPage, setBalPage] = React.useState(0);
    const [holder, setHolder] = React.useState(-1);

    const loadState = async () =>
        await Promise.all([loadBalances(), loadTransactions()]);

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

    const loadTransactions = async () => {
        const txs =
            (await window.api.query<[number, Transaction][]>(
                "transactions",
                txPage,
                userToPrincipal[term.toLowerCase()] || term
            )) || [];
        if (txs?.length == 0) {
            setNoMoreData(true);
        }
        setTransactions(term && txPage == 0 ? txs : transactions.concat(txs));
    };

    React.useEffect(() => {
        loadState();
    }, []);
    React.useEffect(() => {
        loadTransactions();
    }, [txPage]);

    const mintedSupply = balances.reduce((acc, balance) => acc + balance[1], 0);
    const { total_supply, proposal_approval_threshold, transaction_fee } =
        window.backendCache.config;
    const balanceAmounts = balances.map(([_, balance]) => balance);
    balanceAmounts.sort((a, b) => b - a);
    let balancesTotal = balanceAmounts.length;
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
            if (userName) acc[userName.toLowerCase()] = balance[0];
            return acc;
        },
        {} as { [name: string]: string }
    );
    const { holders, e8s_for_one_xdr, e8s_revenue_per_1k } =
        window.backendCache.stats;

    switch (status) {
        case 0:
            return <Loading />;
        case -1:
            return <NotFound />;
    }

    return (
        <>
            <HeadBar title="TOKENS" shareLink="tokens" />
            <div className="spaced">
                <div className="dynamic_table vertically_spaced">
                    <div className="db_cell">
                        MINTED<code>{token(mintedSupply)}</code>
                    </div>
                    <div className="db_cell">
                        TOTAL<code>{token(total_supply)}</code>
                    </div>
                    <div className="db_cell">
                        HOLDERS<code>{holders}</code>
                    </div>
                    <div className="db_cell">
                        WEEKLY REVENUE (10K TOKENS)
                        <code>
                            $
                            {(
                                ((Number(e8s_revenue_per_1k) * 10) /
                                    Number(e8s_for_one_xdr)) *
                                1.31
                            ).toLocaleString()}
                        </code>
                    </div>
                    <div className="db_cell">
                        MINTING RATIO
                        <code>
                            {1 <<
                                Math.floor((10 * mintedSupply) / total_supply)}
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
                        TRANSACTION FEE
                        <code>
                            {Number(
                                transaction_fee /
                                    Math.pow(
                                        10,
                                        window.backendCache.config
                                            .token_decimals
                                    )
                            ).toLocaleString()}
                        </code>
                    </div>
                </div>
                <h2>Top 100 token holders</h2>
                <div className="row_container bottom_spaced">
                    {balances.slice(0, 100).map((b) => (
                        <div
                            key={b[0]}
                            style={{
                                height: "5em",
                                width: percentage(b[1], mintedSupply),
                                background:
                                    holder == b[2] ? "white" : genColor(b[0]),
                            }}
                            onMouseOver={() => setHolder(b[2])}
                            onClick={() => setHolder(b[2])}
                        ></div>
                    ))}
                </div>
                Holder: {holder < 0 ? "none" : <UserLink id={holder} />}
                <hr />
                <h2>Balances</h2>
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
                            <tr key={b[0]}>
                                <td style={{ textAlign: "left" }}>
                                    {principal(b[0])}
                                </td>
                                <td>{token(b[1])}</td>
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
                        placeholder="Principal or username"
                        value={term}
                        onChange={(event) => setTerm(event.target.value)}
                    />
                    <button
                        className="active"
                        onClick={async () => {
                            setTxPage(0);
                            await loadTransactions();
                        }}
                    >
                        SEARCH
                    </button>
                </div>
                <Transactions transactions={transactions} />
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
            </div>
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
        <div className="spaced">
            <HeadBar
                title={`TRANSACTION #${id}`}
                shareLink={`transaction/${id}`}
            />
            <div>
                <div className="bottom_spaced">
                    TIMESTAMP:{" "}
                    <code>
                        {new Date(
                            Number(tx.timestamp) / 1000000
                        ).toLocaleString()}
                    </code>
                </div>
                <div className="bottom_spaced">
                    FROM:{" "}
                    <code>
                        <CopyToClipboard
                            value={tx.from.owner}
                            displayMap={(v) =>
                                bigScreen() ? v : v.split("-")[0]
                            }
                        />
                    </code>
                </div>
                <div className="bottom_spaced">
                    TO:{" "}
                    <code>
                        <CopyToClipboard
                            value={tx.to.owner}
                            displayMap={(v) =>
                                bigScreen() ? v : v.split("-")[0]
                            }
                        />
                    </code>
                </div>
                <div className="bottom_spaced">
                    AMOUNT: <code>{tokenBalance(tx.amount)}</code>
                </div>
                <div className="bottom_spaced">
                    FEE: <code>{tokenBalance(tx.fee)}</code>
                </div>
                <>
                    MEMO: <code>{JSON.stringify(tx.memo)}</code>
                </>
            </div>
        </div>
    );
};

export const Transactions = ({
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
                        {format(t.from.owner)}
                    </td>
                    <td style={{ textAlign: "center" }}>
                        {format(t.to.owner)}
                    </td>
                    <td>{tokenBalance(t.amount)}</td>
                </tr>
            ))}
        </tbody>
    </table>
);

const format = (acc: string) => (acc == "2vxsx-fae" ? "🌱" : principal(acc));

const principal = (p: string) => (
    <CopyToClipboard value={p} displayMap={(id) => id.split("-")[0]} />
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
