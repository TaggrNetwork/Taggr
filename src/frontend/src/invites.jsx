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
            <h1>Create an invite</h1>
            <ul>
                <li>You can invite new users to {backendCache.config.name} by creating invites for them.</li>
                <li>Every invite is a funded by at least <code>{backendCache.config.min_cycles_for_inviting}</code> cycles: you will be charged once the invite is used.</li>
                <li>Invites are not cancelable.</li>
                <li>The invite will not work if your cycle balance drops below the amount attached to the invite.</li>
            </ul>
            <div className="vcentered">
                <input type="number" value={cycles} className="max_width_col" onChange={event => setCycles(parseInt(event.target.value))} />
                {!busy && <button className="vertically_spaced active" onClick={async () =>{
                    setBusy(true);
                    const result = await api.call("create_invite", cycles); 
                    if ("Err" in result) alert(`Failed: ${result.Err}`);
                    else loadInvites();
                    setBusy(false)
                }}>CREATE</button>}
            </div>
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
