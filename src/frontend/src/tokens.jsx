import {bigScreen, ButtonWithLoading, CopyToClipboard, HeadBar, Loading, percentage, timeAgo, token, UserLink} from "./common";
import * as React from "react";

export const Tokens = () => {
    const [balances, setBalances] = React.useState([]);
    const [term, setTerm] = React.useState("");
    const [noMoreData, setNoMoreData] = React.useState(false);
    const [transactions, setTransactions] = React.useState([]);
    const [page, setPage] = React.useState(0);

    const loadState = async () => await Promise.all([ loadBalances(), loadTransactions() ]);

    const loadBalances = async () => {
        const balances = await window.api.query("balances");
        balances.sort((a, b) => parseInt(b[1]) - parseInt(a[1]));
        setBalances(balances);
    };

    const loadTransactions = async () => {
        const txs = await window.api.query("transactions", page, term);
        if (txs.length == 0) {
            setNoMoreData(true);
        }
        setTransactions(term && page == 0 ? txs : transactions.concat(txs));
    };

    React.useEffect(() => { loadState(); }, []);
    React.useEffect(() => { loadTransactions(); }, [page]);

    const totalSupply = balances.reduce((acc, balance) => acc + balance[1], 0);

    return <>
        <HeadBar title="Tokens" shareLink="tokens" />
        {balances.length == 0 && <Loading />}
        {balances.length > 0 && <div className="vertically_spaced spaced">
            <h1>Supply: <code>{token(totalSupply)}</code> / <code>{token(backendCache.config.total_supply)}</code></h1>
            <hr />
            <br />
            <h1>TOP 25 balances</h1>
            <table style={{width: "100%"}}>
                <thead className={bigScreen() ? null : "small_text"}>
                    <tr>
                        <th style={{textAlign: "left"}}>Principal</th>
                        <th style={{textAlign: "right"}}>Balance</th>
                        <th style={{textAlign: "right"}}>Share</th>
                        <th style={{textAlign: "right"}}>User</th>
                    </tr>
                </thead>
                <tbody style={{textAlign: "right"}} className={`monospace ${bigScreen() ? null : "small_text"}`}>
                    {balances.slice(0, 25).map(b => <tr key={b[0]}>
                        <td style={{textAlign: "left"}}>{principal(b[0])}</td>
                        <td>{token(b[1])}</td>
                        <td>{percentage(b[1], totalSupply)}</td>
                        <td><UserLink id={b[2]} /></td>
                    </tr>)}
                </tbody>
            </table>
            <hr />
            <br />
            <h1>Latest transactions</h1>
            <div className="row_container">
                <input id="search_field" className="monospace max_width_col" type="search"
                    placeholder="Principal sub-string" value={term}
                    onChange={event => setTerm(event.target.value)} />
                <button className="active" onClick={async () => {
                    setPage(0);
                    await loadTransactions();
                }}>SEARCH</button>
            </div>
            <table style={{width: "100%"}}>
                <thead style={{textAlign: "right"}} className={bigScreen() ? null : "small_text"}>
                    <tr>
                        <th style={{textAlign: "left"}}>ID</th>
                        <th style={{textAlign: "left"}}>Time</th>
                        <th style={{textAlign: "center"}}>From</th>
                        <th style={{textAlign: "center"}}>To</th>
                        <th>Amount</th>
                        <th>Fee</th>
                    </tr>
                </thead>
                <tbody style={{textAlign: "right"}} className={`monospace ${bigScreen() ? null : "small_text"}`}>
                    {transactions.map(([id, t]) => <tr key={JSON.stringify(t)}>
                        <td style={{textAlign: "left"}}>{id}</td>
                        <td style={{textAlign: "left"}}>{timeAgo(t.timestamp)}</td>
                        <td style={{textAlign: "center"}}>{format(t.from.owner)}</td>
                        <td style={{textAlign: "center"}}>{format(t.to.owner)}</td>
                        <td>{token(t.amount)}</td>
                        <td>{t.fee.toLocaleString()}</td>
                    </tr>)}
                </tbody>
            </table>
            <hr />
            {!noMoreData && <div style={{display:"flex", justifyContent: "center"}}>
                <ButtonWithLoading classNameArg="active" onClick={() => setPage(page + 1)} label="MORE" />
            </div>}
        </div>}
    </>;
}

const format = acc => acc == "2vxsx-fae" ? "🌱" : principal(acc);

const principal = p => <CopyToClipboard value={p} displayMap={id => id.split("-")[0]} />;
