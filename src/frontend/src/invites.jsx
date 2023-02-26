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
                <li>Every invite is charged with your cycles and will be closed after being used by a new user.</li>
                <li>Invites are not refundable.</li>
                <li>If your invite gets accepted, you'll get rewarded with <code>{backendCache.config.invited_user_reward}</code> karma points.</li>
            </ul>
            <h2>Create an invite with cycles (min. <code>{backendCache.config.min_cycles_for_inviting}</code>)</h2>
            <input type="number" value={cycles} onChange={event => setCycles(parseInt(event.target.value))} />
            <br />
            {!busy && <button className="top_spaced active" onClick={async () =>{
                setBusy(true);
                const err = await api.call("create_invite", cycles); 
                if (err) alert(`Failed: ${err}`);
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
