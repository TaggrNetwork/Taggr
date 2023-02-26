import {CopyToClipboard, HeadBar, Loading} from "./common";
import * as React from "react";

export const Ledger = () => {
    const [invoice, setInvoice] = React.useState(null);
    const [loadingInvoice, setLoadingInvoice] = React.useState(false);

    const checkPayment = async () => {
        setLoadingInvoice(true);
        let invoice = await api.call("buy_cycles");
        setLoadingInvoice(false);
        setInvoice(invoice);
        if (invoice.paid) await api._reloadUser();
    };

    return <>
        <HeadBar title={api._user ? "Cycles Ledger" : "Welcome!"} shareLink="ledger" />
        <div className="spaced vertically_spaced">
            {api._user && <div className="bottom_spaced">Your current cycles balance: <code>{api._user.cycles.toLocaleString()}</code></div>}
            {!api._user && <div className="bottom_spaced">
                To join {backendCache.config.name} you need to mint cycles.
                You get <code>1000</code> cycles for as little as <code>~1.3 USD</code> (corresponds to 1 <a href="https://en.wikipedia.org/wiki/Special_drawing_rights">XDR</a>) paid by ICP.
                <br />
                <br />
                Before you mint cycles, make sure you understand <a href="#/about">how {backendCache.config.name} works</a> and agree with the content policy!
                <br />
                <br />
            </div>}
            {loadingInvoice && <div className="text_centered stands_out">Checking the balance... This can take up to a minute.<br /><br/><Loading /></div>}
            {!invoice && !loadingInvoice && <button className="active" onClick={checkPayment}>MINT CYCLES</button>}
            {invoice && invoice.paid && <span>
                Payment verified! ✅
                <br />
                <br />
                {!api._user && <button className="active" onClick={() => location.href = "/#/settings"}>CREATE USER</button>}
            </span>}
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
        <div className="spaced">
            {api._user && <>
                <h2>Cyles and Karma Ledger</h2>
                <table style={{width: "100%"}}>
                    <tbody>
                        {api._user.ledger.map(([type, delta, log], i) => 
                        <tr className="stands_out" key={type+log+i}>
                            <td>{type == "KRM" ? "☯️" : "⚡️"}</td>
                            <td style={{color: delta > 0 ? "green" : "red"}}>{delta > 0 ? "+" : ""}{delta}</td>
                            <td>{linkPost(log)}</td>
                        </tr>)}
                    </tbody>
                </table>
            </>}
            <div className="small_text text_centered topped_up">
                Principal ID: <CopyToClipboard value={api._principalId} />
            </div>
        </div>
    </>;
}

const hex = arr => Array.from(arr, byte => ('0' + (byte & 0xFF).toString(16)).slice(-2)).join('');

const linkPost = line => {
    const [prefix, id] = line.split(" post ");
    if (id) {
        return <span>{prefix} post <a href={`#/post/${id}`}>{id}</a></span>;
    } else return line;
};
