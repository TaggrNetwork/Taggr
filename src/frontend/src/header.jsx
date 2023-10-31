import * as React from "react";
import {
    BurgerButton,
    ButtonWithLoading,
    currentRealm,
    HeadBar,
    ReactionToggleButton,
    RealmSpan,
    ToggleButton,
} from "./common";
import { LoginMasks, logout } from "./logins";
import {
    Balloon,
    Bars,
    Bell,
    CarretDown,
    Cycles,
    Document,
    Gear,
    Gem,
    Journal,
    Logout,
    Realm,
    Save,
    Ticket,
    User,
    Wallet,
} from "./icons";
import { RealmHeader } from "./realms";
import { STAGING_MODE } from "./env";

let interval = null;

export const Header = ({ subtle, route, inboxMode, user }) => {
    const [showLogins, setShowLogins] = React.useState(
        !user && location.href.includes("?join"),
    );
    const [showButtonBar, toggleButtonBar] = React.useState(false);
    const [showRealms, toggleRealms] = React.useState(false);
    const [messages, setMessages] = React.useState(0);

    const realm = currentRealm();

    const inboxEmpty = !user || messages == 0;
    const refreshMessageCounter = () =>
        setMessages(user ? Object.keys(user.inbox).length : 0);
    React.useEffect(() => {
        document.getElementById("logo").innerHTML = backendCache.config.logo;
    }, []);
    React.useEffect(() => {
        toggleButtonBar(false);
        toggleRealms(false);
    }, [route]);
    React.useEffect(refreshMessageCounter, [user]);
    React.useEffect(() => {
        if (inboxMode) interval = setInterval(refreshMessageCounter, 1000);
        else clearInterval(interval);
        refreshMessageCounter();
    }, [inboxMode]);

    return (
        <>
            {STAGING_MODE && (
                <div className="banner vertically_spaced">
                    THIS IS THE STAGING VERSION OF{" "}
                    <a
                        href={`https://${window.backendCache.config.domains[0]}`}
                    >
                        {window.backendCache.config.name.toUpperCase()}
                    </a>
                    !
                </div>
            )}
            <header
                className={`spaced top_half_spaced vcentered ${
                    subtle ? "subtle" : ""
                }`}
            >
                <a
                    href="#/home"
                    id="logo"
                    className="left_half_spaced"
                    data-testid="home-page-link"
                ></a>
                {user && user.realms.length > 0 && !subtle && (
                    <ReactionToggleButton
                        classNameArg="left_half_spaced"
                        pressed={showRealms}
                        onClick={() => {
                            toggleRealms(!showRealms);
                            toggleButtonBar(false);
                        }}
                        icon={<CarretDown classNameArg="large_text" />}
                        testId="toggle-realms"
                    />
                )}
                <div className="vcentered max_width_col flex_ended">
                    {!subtle && (
                        <>
                            {user && !inboxEmpty && (
                                <span
                                    className="clickable vcentered"
                                    onClick={() => (location.href = "#/inbox")}
                                >
                                    <Bell classNameArg="accent" />
                                    <code className="left_half_spaced right_spaced">{`${messages}`}</code>
                                </span>
                            )}
                            {user && inboxEmpty && (
                                <div className="vcentered">
                                    <Cycles />
                                    <code className="left_half_spaced right_spaced">{`${user.cycles.toLocaleString()}`}</code>
                                </div>
                            )}
                            {user && (
                                <PostButton classNameArg="right_half_spaced" />
                            )}
                            {!window.principalId && (
                                <ToggleButton
                                    classNameArg={!showLogins && "active"}
                                    toggler={() => setShowLogins(!showLogins)}
                                    currState={() => showLogins}
                                    onLabel="CLOSE"
                                    offLabel="CONNECT"
                                />
                            )}
                        </>
                    )}
                    {window.principalId && (
                        <BurgerButton
                            onClick={() => {
                                toggleButtonBar(!showButtonBar);
                                toggleRealms(false);
                            }}
                            pressed={showButtonBar}
                            testId="burger-button"
                        />
                    )}
                </div>
            </header>
            {showLogins && <LoginMasks />}
            {showButtonBar && (
                <div
                    className="two_column_grid_flex top_spaced stands_out"
                    style={{ rowGap: "1em" }}
                >
                    {user && (
                        <a
                            className="iconed"
                            onClick={() => toggleButtonBar(!showButtonBar)}
                            href={`/#/journal/${user.name}`}
                        >
                            <Journal /> JOURNAL
                        </a>
                    )}
                    {user && (
                        <a
                            className="iconed"
                            onClick={() => toggleButtonBar(!showButtonBar)}
                            href={`/#/user/${user.name}`}
                        >
                            <User /> {user.name.toUpperCase()}
                        </a>
                    )}
                    {user && (
                        <a
                            className="iconed"
                            onClick={() => toggleButtonBar(!showButtonBar)}
                            href={`/#/realms`}
                        >
                            <Realm /> REALMS
                        </a>
                    )}
                    {user && (
                        <a
                            className="iconed"
                            onClick={() => toggleButtonBar(!showButtonBar)}
                            href={`/#/bookmarks`}
                        >
                            <Save /> BOOKMARKS
                        </a>
                    )}
                    {user && (
                        <a
                            className="iconed"
                            onClick={() => toggleButtonBar(!showButtonBar)}
                            href="/#/wallet"
                        >
                            <Wallet /> WALLET
                        </a>
                    )}
                    {user && (
                        <a
                            className="iconed"
                            onClick={() => toggleButtonBar(!showButtonBar)}
                            href="/#/invites"
                        >
                            <Ticket /> INVITES
                        </a>
                    )}
                    {user && (
                        <a
                            className="iconed"
                            onClick={() => toggleButtonBar(!showButtonBar)}
                            href="/#/settings"
                        >
                            <Gear /> SETTINGS
                        </a>
                    )}
                    <a
                        className="iconed"
                        onClick={() => toggleButtonBar(!showButtonBar)}
                        href="/#/dashboard"
                    >
                        <Bars /> DASHBOARD
                    </a>
                    <a
                        className="iconed"
                        onClick={() => toggleButtonBar(!showButtonBar)}
                        href="/#/tokens"
                    >
                        <Gem /> TOKENS
                    </a>
                    <a
                        className="iconed"
                        onClick={() => toggleButtonBar(!showButtonBar)}
                        href="/#/proposals"
                    >
                        <Balloon /> PROPOSALS
                    </a>
                    <a
                        className="iconed"
                        onClick={() => toggleButtonBar(!showButtonBar)}
                        href="/#/whitepaper"
                    >
                        <Document /> WHITE PAPER
                    </a>
                    <a className="iconed" href="" onClick={logout}>
                        <Logout /> LOGOUT
                    </a>
                </div>
            )}
            {showRealms && (
                <div className="dynamic_table top_spaced stands_out">
                    {user.realms.map((realm) => (
                        <RealmSpan
                            key={realm}
                            classNameArg="left_half_spaced right_half_spaced clickable padded_rounded text_centered"
                            onClick={() => (location.href = `#/realm/${realm}`)}
                            name={realm}
                        />
                    ))}
                </div>
            )}
            {realm && <RealmHeader name={realm} />}
        </>
    );
};

const PostButton = ({ classNameArg }) => (
    <button
        className={`active ${classNameArg || ""}`}
        onClick={() => (location.href = "#/new")}
    >
        POST
    </button>
);
