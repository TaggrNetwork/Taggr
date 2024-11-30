import * as React from "react";
import {
    BurgerButton,
    currentRealm,
    IconToggleButton,
    RealmList,
    ToggleButton,
    signOut,
} from "./common";
import { LoginMasks } from "./authentication";
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
import { STAGING_MODE } from "./env";
import { User as UserType } from "./types";
import { Wallet } from "./wallet";
import { Links } from "./landing";
import { UserLink } from "./user_resolve";

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
    const [showLogins, setShowLogins] = React.useState(
        !user && location.href.includes("?join"),
    );
    const [showUserSection, toggleUserSection] = React.useState(false);
    const [showRealms, toggleRealms] = React.useState(false);
    const [showLinks, toggleLinks] = React.useState(false);
    const [messages, setMessages] = React.useState(0);

    const realm = currentRealm();

    const refreshMessageCounter = () =>
        setMessages(
            user
                ? Object.values(user.notifications).filter(
                      ([_, status]) => !status,
                  ).length
                : 0,
        );
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
                            {user.realms.length > 0 && !subtle && (
                                <IconToggleButton
                                    pressed={showRealms}
                                    onClick={() => {
                                        toggleRealms(!showRealms);
                                        toggleUserSection(false);
                                        toggleLinks(false);
                                    }}
                                    icon={<Realm />}
                                    testId="toggle-realms"
                                />
                            )}
                            <IconToggleButton
                                pressed={showUserSection}
                                onClick={() => {
                                    toggleUserSection(!showUserSection);
                                    toggleRealms(false);
                                    toggleLinks(false);
                                }}
                                icon={<User />}
                                testId="toggle-user-section"
                            />
                            <IconToggleButton
                                title="Inbox"
                                pressed={location.href.includes("inbox")}
                                classNameArg="right_half_spaced"
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
                            <button
                                className={"active"}
                                onClick={() => (location.href = "#/new")}
                            >
                                POST
                            </button>
                            <BurgerButton
                                pressed={showLinks}
                                onClick={() => {
                                    toggleRealms(false);
                                    toggleUserSection(false);
                                    toggleLinks(!showLinks);
                                }}
                                testId="toggle-links"
                            />
                        </>
                    )}
                    {!window.getPrincipalId() && (
                        <ToggleButton
                            classNameArg={showLogins ? undefined : "active"}
                            toggler={() => setShowLogins(!showLogins)}
                            currState={() => showLogins}
                            onLabel="CLOSE"
                            offLabel="CONNECT"
                        />
                    )}
                </div>
            </header>
            {showLogins && <LoginMasks />}
            {showUserSection && <UserSection user={user} />}
            {showLinks && <Links />}
            {showRealms && (
                <RealmList
                    classNameArg="top_spaced stands_out centered"
                    ids={user.realms}
                />
            )}
            {realm && <RealmHeader name={realm} />}
        </>
    );
};

const UserSection = ({ user }: { user: UserType }) => {
    return (
        <div className="bottom_spaced stands_out">
            <div className="column_container centered">
                {user && (
                    <UserLink
                        classNameArg="centered xx_large_text bottom_spaced top_spaced"
                        profile={true}
                        id={user.id}
                        name={user.name}
                    />
                )}

                <div className="row_container icon_bar top_half_spaced">
                    {user && (
                        <>
                            <a
                                title="JOURNAL"
                                className="icon_link"
                                href={`/#/journal/${user.name}`}
                            >
                                <Journal /> JOURNAL
                            </a>
                            <a
                                title="INVITES"
                                className="icon_link"
                                href="/#/invites"
                            >
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
                                <Gear /> SETTING
                            </a>
                        </>
                    )}
                    <a
                        title="SIGN OUT"
                        className="icon_link"
                        href=""
                        onClick={signOut}
                    >
                        <Logout /> SIGN OUT
                    </a>
                </div>
            </div>
            {user && <Wallet />}
        </div>
    );
};
