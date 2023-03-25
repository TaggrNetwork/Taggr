import {CopyToClipboard, HeadBar, Loading, hex, ICPAccountBalance, tokenBalance, ButtonWithLoading, bigScreen, IcpAccountLink} from "./common";
import * as React from "react";
import {Transactions} from "./tokens";

const Welcome = () => {
    const [invoice, setInvoice] = React.useState(null);
    const [loadingInvoice, setLoadingInvoice] = React.useState(false);

    const checkPayment = async () => {
        setLoadingInvoice(true);
        const result = await api.call("mint_cycles", 0);
        setLoadingInvoice(false);
        if ("Err" in result) {
            alert(`Error: ${result.Err}`);
            return;
        }
        if (result.Ok.paid) await api._reloadUser();
        setInvoice(result.Ok);
    };

    return <>
        <HeadBar title={"Welcome!"} shareLink="welcome" />
        <div className="spaced">
            <div className="bottom_spaced">
                To join {backendCache.config.name} you need to mint cycles.
                You get <code>1000</code> cycles for as little as <code>~1.3 USD</code> (corresponds to 1 <a href="https://en.wikipedia.org/wiki/Special_drawing_rights">XDR</a>) paid by ICP.
                <br />
                <br />
                Before you mint cycles, make sure you understand <a href="#/whitepaper">how {backendCache.config.name} works</a>!
                <br />
                <br />
            </div>
            {loadingInvoice && <div className="text_centered stands_out">
                Checking the balance... This can take up to a minute.
                <Loading classNameArg="vertically_spaced" />
            </div>}
            {!invoice && !loadingInvoice && <button className="active vertically_spaced" onClick={checkPayment}>MINT CYCLES</button>}
            {invoice && invoice.paid && <div>
                Payment verified! ✅
                <br />
                <br />
                <button className="active top_spaced" onClick={() => location.href = "/#/settings"}>CREATE USER</button>
            </div>}
            {invoice && !invoice.paid && <div className="stands_out">
                Please transfer&nbsp;
                <CopyToClipboard value={(parseInt(invoice.e8s) / 1e8)} /> ICP to account<br />
                <CopyToClipboard value={(hex(invoice.account))} /><br/> to mint <code>1000</code> cycles.
                <br />
                <br />
                (Larger transfers will mint a proportionally larger number of cycles.)
                <br />
                <br />
                <button className="active" onClick={() => { setInvoice(null); checkPayment()}}>CHECK PAYMENT</button></div>}
        </div>
        <div className="small_text text_centered topped_up">
            Principal ID: <CopyToClipboard value={api._principalId} />
        </div>
    </>;
}

export const Wallet = () => {
    const [user, setUser] = React.useState(api._user);
    const [mintStatus, setMintStatus] = React.useState(null);
    const [transferStatus, setTransferStatus] = React.useState(null);
    const mintCycles = async kilo_cycles => await api.call("mint_cycles", kilo_cycles);
    const [transactions, setTransactions] = React.useState([]);

    const loadTransactions = async () => {
        if (!api._user) return;
        const txs = await window.api.query("transactions", 0, api._user.principal);
        setTransactions(txs);
    };

    React.useEffect(() => { loadTransactions(); }, []);

    if (!user) return <Welcome />;
    let { token_symbol, token_decimals, name} = backendCache.config;

    return <>
        <HeadBar title={"Wallets"} shareLink="wallets" />
        <div className="spaced">
            <div className="stands_out">
                <div className="vcentered">
                    <h1 className="max_width_col">ICP</h1>
                    <ButtonWithLoading label="TRANSFER" onClick={async () => {
                        const amount = prompt("Enter the amount (fee: 0.0001 ICP)");
                        if (!amount) return;
                        const recipient = prompt("Enter the recipient address");
                        if (!recipient) return;
                        if(!confirm(`You are transferring\n\n${amount} ICP\n\nto\n\n${recipient}`)) return;
                        let result = await api.call("transfer_icp", recipient, amount);
                        if ("Err" in result) {
                            alert(`Error: ${result.Err}`);
                            return;
                        }
                        setTransferStatus("DONE!");
                    }} />
                </div>
                <div className="vcentered">
                    {!transferStatus && <code className="max_width_col">
                        <CopyToClipboard value={user.account}
                            displayMap={val => <IcpAccountLink label={bigScreen() ? val : val.slice(0, 16)} address={user.account} /> } 
                        />
                    </code>}
                    {transferStatus && <code className="max_width_col">{transferStatus}</code>}
                    <code><ICPAccountBalance address={user.account} units={false} decimals={true} /></code>
                </div>
            </div>
            <div className="stands_out">
                <div className="vcentered">
                    <h1 className="max_width_col">{name} Cycles</h1>
                    <ButtonWithLoading onClick={async () => {
                        const kilo_cycles = parseInt(prompt("Enter the number of 1000s of cycles to mint", 1));
                        if (isNaN(kilo_cycles)) {
                            return
                        }
                        const result = await mintCycles(Math.max(1, kilo_cycles));
                        if ("Err" in result) {
                            alert(`Error: ${result.Err}`);
                            return;
                        }
                        const invoice = result.Ok;
                        if (invoice.paid) {
                            await api._reloadUser();
                            setUser(api._user);
                        }
                        setMintStatus("SUCCESS!");
                    }} label="MINT" />
                </div>
                <div className="vcentered">
                    <div className="max_width_col">
                        {mintStatus && <code>{mintStatus}</code>}
                    </div>
                    <code className="xx_large_text">{user.cycles.toLocaleString()}</code>
                </div>
            </div>
            <div className="stands_out">
                <div className="vcentered">
                    <h1 className="max_width_col">{token_symbol} TOKENS</h1>
                    <ButtonWithLoading label="TRANSFER" onClick={async () => {
                        const amount = prompt(`Enter the amount (fee: ${1/Math.pow(10, token_decimals)} ${token_symbol})`);
                        if (!amount) return;
                        const recipient = prompt("Enter the recipient principal");
                        if (!recipient) return;
                        if(!confirm(`You are transferring\n\n${amount} ${token_symbol}\n\nto\n\n${recipient}`)) return;
                        let result = await api.call("transfer_tokens", recipient, amount);
                        if ("Err" in result) {
                            alert(`Error: ${result.Err}`);
                            return;
                        }
                        await api._reloadUser();
                        setUser(api._user);
                    }} />
                </div>
                <div className="vcentered">
                    <code className="max_width_col"><CopyToClipboard value={user.principal} displayMap={val => bigScreen() ? val : val.split("-")[0]} /></code>
                    <code className="xx_large_text">{tokenBalance(user.balance)}</code>
                </div>
                <hr/>
                <h2>Latest Transactions</h2>
                <Transactions transactions={transactions} />
            </div>
        </div>
    </>;
};
