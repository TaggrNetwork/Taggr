import * as React from "react";
import { PostFeed } from "./post_feed";
import { Search } from "./search";
import { bigScreen, currentRealm, domain, showPopUp } from "./common";
import {
    New,
    User,
    Bars,
    Gem,
    Balloon,
    Document,
    Fire,
    Realm,
    Link,
    CashCoin,
    Globe,
} from "./icons";
import { PostId } from "./types";

const NEW = "NEW";
const HOT = "HOT";
const FOR_ME = "FOR ME";
// Tab ids are persisted in user settings; labels are display-only.
const TAB_LABELS: { [id: string]: string } = {
    [NEW]: "New",
    [HOT]: "Hot",
    [FOR_ME]: "For me",
};

export const Landing = () => {
    const user = window.user;
    const realm = currentRealm();
    const [filtered, setFiltered] = React.useState(true);
    const [feed, setFeed] = React.useState(
        currentRealm() ? NEW : user?.settings.tab || HOT,
    );

    let labels: [JSX.Element, string][] = [[<New />, NEW]];

    labels.push([<Fire />, HOT]);

    if (!realm && user) {
        labels.push([<User classNameArg="vertically_aligned" />, FOR_ME]);
    }

    const title = (
        <div className="vertically_spaced small_text row_container centered">
            {labels.map(([icon, id]: [JSX.Element, string]) => (
                <button
                    key={id}
                    data-testid={`tab-${id}`}
                    onClick={() => {
                        if (user && feed == id && id == NEW) {
                            showPopUp(
                                "info",
                                "Displaying all new posts " +
                                    (filtered ? "without" : "filtered by") +
                                    " user filters",
                            );
                            setFiltered(!filtered);
                        }
                        if (user && !currentRealm()) {
                            user.settings.tab = id;
                            window.api.call<any>(
                                "update_user_settings",
                                user.settings,
                            );
                        }
                        setFeed(id);
                    }}
                    className={
                        `vcentered ${feed == id ? "active" : "unselected"} ` +
                        `${bigScreen() ? "small_text" : "smaller_text"}`
                    }
                >
                    {icon}&nbsp; {TAB_LABELS[id]}
                    {user && feed == NEW && id == NEW && (
                        <span
                            className={`${filtered ? "inactive" : undefined} left_half_spaced`}
                        >
                            &#10035;
                        </span>
                    )}
                </button>
            ))}
        </div>
    );

    return (
        <>
            {!user && !realm && (
                <div className="spaced vertically_spaced text_centered">
                    <h1>Welcome aboard</h1>
                    <p>Decentralised publishing and communication.</p>
                    <button onClick={() => (location.href = "#/whitepaper")}>
                        Learn more
                    </button>
                </div>
            )}
            {!user && !window.hideRealmless && (
                <Links classNameArg="vertically_spaced" />
            )}
            <Search />
            <PostFeed
                heartbeat={feed + filtered}
                title={title}
                feedLoader={async (page: number, offset: PostId) => {
                    if (feed == FOR_ME)
                        return await window.api.query(
                            "personal_feed",
                            domain(),
                            page,
                            offset,
                        );
                    if (feed == HOT)
                        return await window.api.query(
                            "hot_posts",
                            domain(),
                            realm,
                            page,
                            offset,
                            // only enable noise filtering outside of realms
                            !currentRealm(),
                        );
                    return await window.api.query(
                        "last_posts",
                        domain(),
                        realm,
                        page,
                        offset,
                        filtered,
                    );
                }}
            />
        </>
    );
};

export const Links = ({ classNameArg }: { classNameArg?: string }) => {
    return (
        <div
            className={`
                ${bigScreen() ? "row_container icon_bar" : "dynamic_table tripple"}
                ${classNameArg}
            `}
        >
            <a title="White paper" className="icon_link" href="/#/whitepaper">
                <Document /> White paper
            </a>
            <a title="Dashboard" className="icon_link" href="/#/dashboard">
                <Bars /> Dashboard
            </a>
            <a title="Proposals" className="icon_link" href="/#/proposals">
                <Balloon /> Proposals
            </a>
            <a title="Tokens" className="icon_link" href="/#/tokens">
                <Gem /> Tokens
            </a>
            <a title="Realms" className="icon_link" href={`/#/realms`}>
                <Realm /> Realms
            </a>
            <a title="Links" className="icon_link" href="/#/links">
                <Link /> Links
            </a>
            <a title="Domains" className="icon_link" href="/#/domains">
                <Globe /> Domains
            </a>
            <a
                title="Distribution"
                className="icon_link"
                href="/#/distribution"
            >
                <CashCoin /> Distribution
            </a>
        </div>
    );
};
