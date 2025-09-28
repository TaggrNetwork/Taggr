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
    Roadmap,
    CashCoin,
    Globe,
} from "./icons";
import { PostId } from "./types";

const NEW = "NEW";
const HOT = "HOT";
const REALMS = "REALMS";
const BEST_IN_REALMS = "BEST IN REALMS";
const FOR_ME = "FOR ME";

export const Landing = () => {
    const user = window.user;
    const realm = currentRealm();
    const [filtered, setFiltered] = React.useState(true);
    const [feed, setFeed] = React.useState(
        currentRealm() ? NEW : user?.settings.tab || HOT,
    );

    let labels: [JSX.Element, string][] = [[<New />, NEW]];

    labels.push([<Fire />, HOT]);

    if (!realm) {
        if (user) {
            labels.push([<User classNameArg="vertically_aligned" />, FOR_ME]);
            if (user.realms.length > 0) labels.push([<Realm />, REALMS]);
        } else {
            labels.push([<Realm />, BEST_IN_REALMS]);
        }
    }

    const title = (
        <div className="vertically_spaced small_text row_container centered">
            {labels.map(([icon, id]: [JSX.Element, string]) => (
                <button
                    key={id}
                    data-testid={`tab-${id}`}
                    onClick={() => {
                        if (user && feed == id) {
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
                    {icon}&nbsp; {id}
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
                    <h1>WELCOME ABOARD</h1>
                    <p>To the Future of Decentralized Social Networking.</p>
                    <button onClick={() => (location.href = "#/whitepaper")}>
                        LEARN MORE
                    </button>
                </div>
            )}
            {!user && !window.hideRealmless && (
                <Links classNameArg="vertically_spaced" />
            )}
            <Search />
            <PostFeed
                heartbeat={feed + filtered}
                refreshRateSecs={10 * 60}
                title={title}
                feedLoader={async (page: number, offset: PostId) => {
                    if (feed == FOR_ME)
                        return await window.api.query(
                            "personal_feed",
                            domain(),
                            page,
                            offset,
                        );
                    if (feed == BEST_IN_REALMS)
                        return await window.api.query(
                            "hot_realm_posts",
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
                    if (feed == REALMS)
                        return await window.api.query(
                            "realms_posts",
                            domain(),
                            page,
                            offset,
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
            <a title="WHITE PAPER" className="icon_link" href="/#/whitepaper">
                <Document /> WHITE PAPER
            </a>
            <a title="DASHBOARD" className="icon_link" href="/#/dashboard">
                <Bars /> DASHBOARD
            </a>
            <a title="PROPOSALS" className="icon_link" href="/#/proposals">
                <Balloon /> PROPOSALS
            </a>
            <a title="TOKENS" className="icon_link" href="/#/tokens">
                <Gem /> TOKENS
            </a>
            <a title="REALMS" className="icon_link" href={`/#/realms`}>
                <Realm /> REALMS
            </a>
            <a title="LINK" className="icon_link" href="/#/links">
                <Link /> LINKS
            </a>
            <a title="DOMAINS" className="icon_link" href="/#/domains">
                <Globe /> DOMAINS
            </a>
            <a
                title="DISTRIBUTION"
                className="icon_link"
                href="/#/distribution"
            >
                <CashCoin /> DISTRIBUTION
            </a>
            <a title="ROADMAP" className="icon_link" href="/#/roadmap">
                <Roadmap /> ROADMAP
            </a>
        </div>
    );
};
