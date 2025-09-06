import * as React from "react";
import {
    BurgerButton,
    currentRealm,
    IconToggleButton,
    RealmList,
    signOut,
    pfpUrl,
    bigScreen,
    DropDown,
    getCanonicalDomain,
} from "./common";
import {
    Bell,
    Gear,
    Journal,
    Logout,
    Realm,
    Save,
    Ticket,
    User,
} from "./icons";
import { RealmHeader } from "./realms";
import { MAINNET_MODE, STAGING_MODE } from "./env";
import { User as UserType } from "./types";
import { Wallet } from "./wallet";
import { Links } from "./landing";
import { connect } from "./authentication";

let interval: any = null;

export const Header = ({
    subtle,
    route,
    inboxMode,
}: {
    subtle?: boolean;
    route: string;
    inboxMode: boolean;
}) => {
    const user = window.user;
    const [showUserSection, toggleUserSection] = React.useState(false);
    const [showRealms, toggleRealms] = React.useState(false);
    const [showLinks, toggleLinks] = React.useState(false);
    const [messages, setMessages] = React.useState(0);
    const [offset, setOffset] = React.useState(0);

    const realm = currentRealm();

    const refreshMessageCounter = () => {
        const user = window.user;
        if (!user) return;
        let unread_messages = Object.values(user.notifications).filter(
            ([_, status]) => !status,
        ).length;
        if (messages === unread_messages) return;
        setMessages(unread_messages);
    };

    React.useEffect(() => {
        const logo = document.getElementById("logo");
        if (!logo) return;
        logo.innerHTML = window.backendCache.config.logo;
    }, []);
    React.useEffect(() => {
        toggleUserSection(false);
        toggleRealms(false);
        toggleLinks(false);
    }, [route]);
    React.useEffect(refreshMessageCounter, [user]);
    React.useEffect(() => {
        if (inboxMode) interval = setInterval(refreshMessageCounter, 500);
        else clearInterval(interval);
    }, [inboxMode]);

    return (
        <>
            {STAGING_MODE && (
                <div className="banner vertically_spaced">
                    THIS IS THE STAGING VERSION OF{" "}
                    {window.backendCache.config.name.toUpperCase()}!
                </div>
            )}
            <header className="spaced top_half_spaced vcentered">
                {!["/", "#/", "", "#/inbox"].includes(location.hash) && (
                    <span
                        className="clickable_color clickable right_half_spaced left_half_spaced"
                        onClick={() => history.back()}
                    >
                        &#9664;
                    </span>
                )}
                <a
                    href="#/home"
                    id="logo"
                    className="left_half_spaced"
                    data-testid="home-page-link"
                ></a>
                <div className="vcentered max_width_col flex_ended">
                    {!subtle && user && (
                        <>
                            <IconToggleButton
                                title="Inbox"
                                pressed={location.href.includes("inbox")}
                                onClick={() => (location.href = "#/inbox")}
                                icon={
                                    <>
                                        <Bell
                                            classNameArg={
                                                messages > 0
                                                    ? "accent right_half_spaced"
                                                    : undefined
                                            }
                                        />
                                        {messages > 0 && messages}
                                    </>
                                }
                            />
                            {user.realms.length > 0 && !window.monoRealm && (
                                <IconToggleButton
                                    pressed={showRealms}
                                    onClick={(event) => {
                                        toggleRealms(!showRealms);
                                        toggleUserSection(false);
                                        toggleLinks(false);
                                        setOffset(getOffset(event));
                                    }}
                                    icon={<Realm />}
                                    testId="toggle-realms"
                                />
                            )}
                            <IconToggleButton
                                pressed={showUserSection}
                                onClick={(event) => {
                                    toggleUserSection(!showUserSection);
                                    toggleRealms(false);
                                    toggleLinks(false);
                                    setOffset(getOffset(event));
                                }}
                                icon={<User />}
                                testId="toggle-user-section"
                            />
                            {!window.monoRealm && (
                                <BurgerButton
                                    pressed={showLinks}
                                    onClick={(event) => {
                                        toggleRealms(false);
                                        toggleUserSection(false);
                                        toggleLinks(!showLinks);
                                        setOffset(getOffset(event));
                                    }}
                                    testId="toggle-links"
                                />
                            )}
                            {(!realm ||
                                (user && user.realms.includes(realm))) && (
                                <button
                                    className="active left_half_spaced"
                                    onClick={() => (location.href = "#/new")}
                                >
                                    POST
                                </button>
                            )}
                        </>
                    )}
                    {!window.user && !subtle && (
                        <>
                            <button
                                className="right_half_spaced"
                                onClick={() =>
                                    (location.href = `${MAINNET_MODE ? "https://" + getCanonicalDomain() : ""}/#/sign-up`)
                                }
                            >
                                SIGN UP
                            </button>
                            <button className="active" onClick={connect}>
                                SIGN IN
                            </button>
                        </>
                    )}
                </div>
            </header>
            <DropDown offset={offset}>
                {showUserSection && <UserSection user={user} />}
                {showLinks && <Links />}
                {showRealms && (
                    <RealmList classNameArg="centered" ids={user.realms} />
                )}
            </DropDown>
            {realm && <RealmHeader name={realm} heartbeat={location.href} />}
        </>
    );
};

function getOffset(event: React.MouseEvent) {
    const rect = event.currentTarget.getBoundingClientRect();
    const position = rect.left;
    return position;
}

const UserSection = ({ user }: { user: UserType }) => {
    return (
        <>
            <div
                className={`${bigScreen() ? "row_container icon_bar" : "dynamic_table tripple"}
                vcentered`}
            >
                <>
                    <a
                        title={user.name}
                        className="icon_link"
                        href={`/#/user/${user.name}`}
                    >
                        <img src={pfpUrl(user.id)} height={16} width={16} />
                        {user.name.toUpperCase()}
                    </a>
                    <a
                        title="JOURNAL"
                        className="icon_link"
                        href={`/#/journal/${user.name}`}
                    >
                        <Journal /> JOURNAL
                    </a>
                    <a title="INVITES" className="icon_link" href="/#/invites">
                        <Ticket /> INVITES
                    </a>
                    <a
                        title="BOOKMARKS"
                        className="icon_link"
                        href={`/#/bookmarks`}
                    >
                        <Save /> BOOKMARKS
                    </a>
                    <a
                        title="SETTINGS"
                        className="icon_link"
                        href="/#/settings"
                    >
                        <Gear /> SETTINGS
                    </a>
                </>
                <a
                    title="SIGN OUT"
                    className="icon_link"
                    href=""
                    onClick={signOut}
                >
                    <Logout /> SIGN OUT
                </a>
            </div>
            <Wallet />
        </>
    );
};
