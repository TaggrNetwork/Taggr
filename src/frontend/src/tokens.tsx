import {
    bigScreen,
    CopyToClipboard,
    HeadBar,
    Loading,
    MoreButton,
    NotFound,
    percentage,
    timeAgo,
    token,
    TokenBalance,
    tokenBalance,
    USD_PER_XDR,
} from "./common";
import * as React from "react";
import { UserId, Transaction, User, Account } from "./types";
import { Principal } from "@dfinity/principal";
import { decodeIcrcAccount, encodeIcrcAccount } from "@dfinity/ledger-icrc";
import { Content } from "./content";
import { CANISTER_ID } from "./env";
import { UserLink } from "./user_resolve";

type Balances = [Account, number, UserId][];

export const Tokens = () => {
    const [status, setStatus] = React.useState(0);
    const [rewards, setRewards] = React.useState<[UserId, number][]>([]);
    const [donors, setDonors] = React.useState<[UserId, number][]>([]);
    const [showAllRewards, setShowAllRewards] = React.useState(false);
    const [showAllDonors, setShowAllDonors] = React.useState(false);
    const [timer, setTimer] = React.useState<any>(null);
    const [searchValue, setSearchValue] = React.useState("");
    const [query, setQuery] = React.useState("");
    const [balances, setBalances] = React.useState([] as Balances);
    const [balPage, setBalPage] = React.useState(0);
    const [holder, setHolder] = React.useState(-1);

    const loadData = async () => {
        const [balances, rewards, donors] = await Promise.all([
            window.api.query<Balances>("balances"),
            window.api.query<[UserId, number][]>("tokens_to_mint"),
            window.api.query<[UserId, number][]>("donors"),
        ]);

        if (!balances || balances.length == 0) {
            setStatus(-1);
            return;
        }
        setStatus(1);
        balances.sort((a, b) => Number(b[1]) - Number(a[1]));
        setBalances(balances);
        if (donors) setDonors(donors);
        if (!rewards) return;
        rewards.sort(
            ([_id, balance1], [_id2, balance2]) => balance2 - balance1,
        );
        setRewards(rewards);
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
    const {
        maximum_supply,
        proposal_approval_threshold,
        transaction_fee,
        difficulty_amplification,
    } = window.backendCache.config;
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

    switch (status) {
        case 0:
            return <Loading />;
        case -1:
            return <NotFound />;
    }
    let searchedPrincipal;
    try {
        searchedPrincipal = Principal.fromText(query).toString();
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
                        MINING DIFFICULTY
                        <code>
                            {window.backendCache.stats.minting_ratio /
                                difficulty_amplification}{" "}
                            &#215; {difficulty_amplification}
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
                <h2>
                    Upcoming Minting (
                    {token(rewards.reduce((acc, [_, val]) => acc + val, 0))})
                </h2>
                <div
                    className={`dynamic_table ${
                        bigScreen() ? "" : "tripple"
                    } bottom_spaced`}
                >
                    {(showAllRewards ? rewards : rewards.slice(0, 24)).map(
                        ([userId, tokens]) => (
                            <div key={userId} className="db_cell">
                                <UserLink id={userId} />
                                <code>{token(tokens)}</code>
                            </div>
                        ),
                    )}
                </div>
                {!showAllRewards && (
                    <MoreButton
                        callback={async () => setShowAllRewards(true)}
                    />
                )}
                <hr />
                <h2>Largest Donors</h2>
                <div
                    className={`dynamic_table ${
                        bigScreen() ? "" : "tripple"
                    } bottom_spaced`}
                >
                    {(showAllDonors ? donors : donors.slice(0, 24)).map(
                        ([userId, tokens]) => (
                            <div key={userId} className="db_cell">
                                <UserLink id={userId} />
                                <code>{token(tokens)}</code>
                            </div>
                        ),
                    )}
                </div>
                {!showAllDonors && (
                    <MoreButton callback={async () => setShowAllDonors(true)} />
                )}
            </div>
            <hr />
            <div className="spaced">
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
            </div>
            <TransactionsView icrcAccount={searchedPrincipal} />
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
