import * as React from "react";
import {CopyToClipboard, HeadBar, Loading} from "./common";
import {Cycles} from "./icons";

export const Invites = () => {
    const [cycles, setCycles] = React.useState(backendCache.config.min_cycles_for_inviting);
    const [invites, setInvites] = React.useState([]);
    const [busy, setBusy] = React.useState(false);

    const loadInvites = async () => {
        setInvites(await api.query("invites"));
    };

    React.useEffect(() => { loadInvites(); }, []);

    return <>
        <HeadBar title="Invites" shareLink="invites" />
        <div className="spaced">
            <ul>
                <li>You can invite new users to {backendCache.config.name} by creating invites for them.</li>
                <li>Every invite is a delayed charge with your cycles and will be closed after being used by a new user.</li>
                <li>Invites are not refundable.</li>
                <li>The invite will not work if your cycle balance drops below the amount attached to the invite.</li>
            </ul>
            <h2>Create an invite with cycles (min. <code>{backendCache.config.min_cycles_for_inviting}</code>)</h2>
            <input type="number" value={cycles} onChange={event => setCycles(parseInt(event.target.value))} />
            <br />
            {!busy && <button className="top_spaced active" onClick={async () =>{
                setBusy(true);
                const result = await api.call("create_invite", cycles); 
                if ("Err" in result) alert(`Failed: ${result.Err}`);
                else loadInvites();
                setBusy(false)
            }}>CREATE</button>}
            {invites.length > 0 && <h3>Your open invites</h3>}
            {busy && <Loading />}
            {!busy && invites.length > 0 && <ul>
                {invites.map(([code, _cycles]) => <li key={code}>
                <CopyToClipboard value={`${backendCache.config.domains[0]}/#/welcome/${code}`}
                    map={url => `https://${url}`}/>: <Cycles />
                </li>)}
            </ul>}
        </div>
    </>;
}
