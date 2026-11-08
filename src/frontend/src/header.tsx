import * as React from "react";
import {
    BurgerButton,
    currentRealm,
    IconToggleButton,
    RealmList,
    signOutAndRestart,
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

// Deterministic "up" target for deep links, where there is no in-app frame to
// go back to.
const parentHash = (hash: string) => {
    const [handler, param] = hash.replace(/^#\/?/, "").split("/");
    if ((handler === "post" || handler === "edit") && param)
        return `#/thread/${param}`;
    if (handler === "thread" && param) return `#/post/${param}`;
    return "#/";
};

export const Header = ({
    style,
    route,
    inboxMode,
}: {
    style?: string;
    route: string;
    inboxMode: boolean;
}) => {
    const user = window.user;
    const [openMenu, setOpenMenu] = React.useState<
        "user" | "realms" | "links" | null
    >(null);
    const [messages, setMessages] = React.useState(0);
    const [offset, setOffset] = React.useState(0);

    const realm = currentRealm();

    const toggleMenu = (menu: "user" | "realms" | "links") =>
        setOpenMenu(openMenu === menu ? null : menu);

    const goBack = () => {
        const stack = document.getElementById("stack");
        if (stack && stack.children.length > 1) {
            history.back();
            return;
        }
        location.href = parentHash(location.hash);
    };

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
    }, [style]);
    React.useEffect(() => {
        setOpenMenu(null);
    }, [route]);
    // Menus behave like menus: dismiss on an outside click or Escape instead of
    // staying open until the same trigger is pressed again.
    React.useEffect(() => {
        if (!openMenu) return;
        const close = () => setOpenMenu(null);
        const onPointerDown = (event: MouseEvent) => {
            // A dialog owns the interaction; closing the menu underneath it
            // would lose the form the dialog was opened from.
            if (document.querySelector(".modal_overlay")) return;
            const target = event.target;
            if (!(target instanceof Element)) return close();
            if (
                target.closest(
                    '.drop_down, [data-testid="toggle-user-section"], [data-testid="toggle-realms"], [data-testid="toggle-links"]',
                )
            )
                return;
            close();
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            // A dialog stacked on top handles its own dismissal.
            if (document.querySelector(".modal_overlay")) return;
            close();
        };
        document.addEventListener("mousedown", onPointerDown);
        document.addEventListener("keydown", onKeyDown);
        return () => {
            document.removeEventListener("mousedown", onPointerDown);
            document.removeEventListener("keydown", onKeyDown);
        };
    }, [openMenu]);
    React.useEffect(refreshMessageCounter, [user]);
    React.useEffect(() => {
        refreshMessageCounter();
        if (inboxMode) interval = setInterval(refreshMessageCounter, 500);
        else clearInterval(interval);
    }, [inboxMode]);

    if (style === "hidden") return null;

    return (
        <>
            {STAGING_MODE && (
                <div className="banner vertically_spaced">
                    THIS IS THE STAGING VERSION OF{" "}
                    {window.backendCache.config.name}!
                </div>
            )}
            <header className="spaced top_half_spaced vcentered">
                {!["/", "#/", "", "#/home"].includes(location.hash) && (
                    <button
                        className="unselected reaction_button clickable_color"
                        aria-label="Back"
                        title="Back"
                        onClick={goBack}
                    >
                        &#9664;
                    </button>
                )}
                <a
                    href="#/home"
                    id="logo"
                    className="left_half_spaced"
                    data-testid="home-page-link"
                ></a>
                <div className="vcentered max_width_col flex_ended">
                    {!style && user && (
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
                                    pressed={openMenu === "realms"}
                                    onClick={(event) => {
                                        toggleMenu("realms");
                                        setOffset(getOffset(event));
                                    }}
                                    icon={<Realm />}
                                    testId="toggle-realms"
                                />
                            )}
                            <IconToggleButton
                                pressed={openMenu === "user"}
                                onClick={(event) => {
                                    toggleMenu("user");
                                    setOffset(getOffset(event));
                                }}
                                icon={<User />}
                                testId="toggle-user-section"
                            />
                            {!window.monoRealm && (
                                <BurgerButton
                                    pressed={openMenu === "links"}
                                    onClick={(event) => {
                                        toggleMenu("links");
                                        setOffset(getOffset(event));
                                    }}
                                    testId="toggle-links"
                                />
                            )}
                        </>
                    )}
                    {!style &&
                        user &&
                        (!realm || user.realms.includes(realm)) && (
                            <button
                                className="active left_half_spaced"
                                onClick={() => (location.href = "#/new")}
                            >
                                Post
                            </button>
                        )}
                    {!window.user && !style && (
                        <>
                            <button
                                className="right_half_spaced"
                                onClick={() =>
                                    (location.href = `${MAINNET_MODE ? "https://" + getCanonicalDomain() : ""}/#/sign-up`)
                                }
                            >
                                Sign up
                            </button>
                            <button className="active" onClick={connect}>
                                Sign in
                            </button>
                        </>
                    )}
                </div>
            </header>
            <DropDown offset={offset}>
                {openMenu === "user" && <UserSection user={user} />}
                {openMenu === "links" && <Links />}
                {openMenu === "realms" && (
                    <RealmList classNameArg="centered" ids={user.realms} />
                )}
            </DropDown>
            {realm && <RealmHeader name={realm} heartbeat={location.href} />}
        </>
    );
};

function getOffset(event: React.MouseEvent) {
    const rect = event.currentTarget.getBoundingClientRect();
    return rect.left;
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
                        data-testid="menu-profile-link"
                    >
                        <User /> {user.name}
                    </a>
                    <a
                        title="Journal"
                        className="icon_link"
                        href={`/#/journal/${user.name}`}
                    >
                        <Journal /> Journal
                    </a>
                    <a title="Invites" className="icon_link" href="/#/invites">
                        <Ticket /> Invites
                    </a>
                    <a
                        title="Bookmarks"
                        className="icon_link"
                        href={`/#/bookmarks`}
                    >
                        <Save /> Bookmarks
                    </a>
                    <a
                        title="Settings"
                        className="icon_link"
                        href="/#/settings"
                    >
                        <Gear /> Settings
                    </a>
                </>
                <a
                    title="Sign out"
                    className="icon_link"
                    href=""
                    onClick={(e) => {
                        // Prevent the default navigation: `signOutAndRestart`
                        // reloads the app itself once the async sign-out
                        // (including the IndexedDB wipe) has finished.
                        e.preventDefault();
                        signOutAndRestart();
                    }}
                >
                    <Logout /> Sign out
                </a>
            </div>
            <Wallet />
        </>
    );
};
