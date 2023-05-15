import * as React from "react";
import {BurgerButton, ButtonWithLoading, HeadBar, Loading, ReactionToggleButton, realmColors, RealmSpan, ToggleButton} from "./common";
import { LoginMasks, logout} from "./logins";
import {Balloon, Bars, Bell, CarretDown, Close, Cycles, Document, Gear, Gem, Home, Journal, Logout, Realm, Save, Ticket, User, Wallet} from "./icons";

let interval = null;

export const Header = ({subtle, route, monitorUser}) => {
    const user = api._user;
    const [showLogins, setShowLogins] = React.useState(!user && location.href.includes("?join"));
    const [showButtonBar, toggleButtonBar] = React.useState(false);
    const [showRealms, toggleRealms] = React.useState(false);
    const [loading, setLoading] = React.useState(false);
    const [inRealm, setInRealm] = React.useState(user && user.current_realm);
    const [messages, setMessages] = React.useState(Object.keys(user.inbox).length);
    const [realmBg, realmFg] = realmColors(user?.current_realm);
    const inboxEmpty = !user || messages == 0;
    React.useEffect(() => { document.getElementById("logo").innerHTML = backendCache.config.logo; }, []);
    React.useEffect(() => { toggleButtonBar(false); toggleRealms(false); }, [route]);
    React.useEffect(() => {
        if (monitorUser)
            interval = setInterval(() => setMessages(Object.keys(user.inbox).length), 1000);
        else clearInterval(interval);
    }, [monitorUser]);


    return <>
        <header className={`spaced top_half_spaced vcentered ${subtle ? "subtle" : ""}`}>
            <a href="#/home" id="logo"></a>
            {user && user.realms.length > 0 && !subtle && <ReactionToggleButton classNameArg="left_half_spaced"
                pressed={showRealms} onClick={() => { toggleRealms(!showRealms); toggleButtonBar(false) }}
                icon={<CarretDown classNameArg="large_text" />} />}
            <div className="vcentered max_width_col flex_ended">
                {!subtle &&  <>
                    {user && !inboxEmpty && <span className="clickable vcentered" onClick={() => location.href = "#/inbox"}>
                        <Bell /><code className="left_half_spaced right_spaced">{`${messages}`}</code>
                    </span>}
                    {user && inboxEmpty && <div className="vcentered"><Cycles /><code className="left_half_spaced right_spaced">{`${user.cycles.toLocaleString()}`}</code></div>}
                    {user && <PostButton classNameArg="right_half_spaced" />}
                    {!api._principalId && <ToggleButton 
                        classNameArg={!showLogins && "active"}
                        toggler={() => setShowLogins(!showLogins)} currState={() => showLogins} onLabel="CLOSE" offLabel="CONNECT" />}
                </>}
                {api._principalId && 
                    <BurgerButton onClick={() => { toggleButtonBar(!showButtonBar); toggleRealms(false) }} pressed={showButtonBar} testId="burger-button" />}
            </div>
        </header>
        {showLogins && <LoginMasks />}
        {showButtonBar && <div className="two_column_grid_flex monospace top_spaced stands_out" style={{ rowGap: "1em" }}>
            {user && <a className="iconed" onClick={() => toggleButtonBar(!showButtonBar)} href={`/#/journal/${user.name}`}><Journal /> JOURNAL</a>}
            {user && <a className="iconed" onClick={() => toggleButtonBar(!showButtonBar)} href={`/#/user/${user.name}`}><User /> {api._user.name.toUpperCase()}</a>}
            {user && <a className="iconed" onClick={() => toggleButtonBar(!showButtonBar)} href={`/#/realms`}><Realm /> REALMS</a>}
            {user && <a className="iconed" onClick={() => toggleButtonBar(!showButtonBar)} href={`/#/bookmarks`}><Save /> BOOKMARKS</a>}
            {user && <a className="iconed" onClick={() => toggleButtonBar(!showButtonBar)} href="/#/wallet"><Wallet /> WALLET</a>}
            {user && <a className="iconed" onClick={() => toggleButtonBar(!showButtonBar)} href="/#/invites"><Ticket /> INVITES</a>}
            {user && <a className="iconed" onClick={() => toggleButtonBar(!showButtonBar)} href="/#/settings"><Gear /> SETTINGS</a>}
            <a className="iconed" onClick={() => toggleButtonBar(!showButtonBar)} href="/#/dashboard"><Bars /> DASHBOARD</a>
            <a className="iconed" onClick={() => toggleButtonBar(!showButtonBar)} href="/#/tokens"><Gem /> TOKENS</a>
            <a className="iconed" onClick={() => toggleButtonBar(!showButtonBar)} href="/#/proposals"><Balloon /> PROPOSALS</a>
            <a className="iconed" onClick={() => toggleButtonBar(!showButtonBar)} href="/#/whitepaper"><Document /> WHITE PAPER</a>
            <a className="iconed" href="" onClick={logout}><Logout /> LOGOUT</a>
        </div>}
        {showRealms && <div className="dynamic_table monospace top_spaced stands_out">
            {user.realms.map(realm => <RealmSpan key={realm}
                classNameArg="left_half_spaced right_half_spaced clickable padded_rounded text_centered"
                onClick={async () => {
                    setLoading(true);
                    toggleRealms(false);
                    await api.call("enter_realm", realm);
                    api._reloadUser().then(() => setInRealm(realm)).then(() => setLoading(false));
                    location.href = `/#/${realm}/home/`;
                }} name={realm} />)}
        </div>}
        {loading && <Loading />}
        {inRealm &&
            <HeadBar title={user.current_realm} shareLink={`realm/${user.current_realm}`} 
                styleArg={{background: realmBg, color: realmFg}}
                content={<>
                    <button style={{background: realmBg}} onClick={() =>location.href = `#/realm/${user.current_realm}`} >
                        <Home styleArg={{fill: realmFg}} />
                    </button>
                    <ButtonWithLoading classNameArg="left_half_spaced monospace"
                        styleArg={{background: realmBg, color: realmFg}}
                        onClick={async () =>{
                            setLoading(true);
                            setInRealm("");
                            await api.call("enter_realm", "");
                            api._reloadUser().then(() => setLoading(false));
                            location.href = "/#/main";
                        }}
                        label={<div className="vcentered"><Close styleArg={{fill: realmFg}} small={true} /></div>}
                    />
                </>}
            />}
    </>;
}

const PostButton = ({classNameArg}) =>
    <button className={`active ${classNameArg || ""}`} onClick={() => location.href = "#/new"}>POST</button>;
