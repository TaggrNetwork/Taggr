import * as React from "react";
import { PostFeed } from "./post_feed";
import { Search } from "./search";
import { bigScreen, currentRealm, Loading } from "./common";
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
    All,
} from "./icons";
import { PostId } from "./types";

const NEW = "NEW";
const ALL = "ALL";
const HOT = "HOT";
const REALMS = "REALMS";
const BEST_IN_REALMS = "BEST IN REALMS";
const FOR_ME = "FOR ME";

export const Landing = () => {
    const user = window.user;
    const realm = currentRealm();
    const [feed, setFeed] = React.useState(
        (!currentRealm() && user && user.settings.tab) || HOT,
    );

    let labels: [JSX.Element, string][] = [[<All />, ALL]];

    if (user) labels.push([<New />, NEW]);

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
                </button>
            ))}
        </div>
    );

    return (
        <>
            {!user && !realm && (
                <div className="spaced vertically_spaced text_centered">
                    <h1>WELCOME ABOARD</h1>
                    <span>
                        To the Future of Decentralized Social Networking.
                    </span>
                </div>
            )}
            {!user && <Links classNameArg="vertically_spaced" />}
            <Search />
            <TagCloud heartbeat={feed} realm={realm} />
            <PostFeed
                heartbeat={feed}
                refreshRateSecs={10 * 60}
                title={title}
                feedLoader={async (page: number, offset: PostId) => {
                    if (feed == FOR_ME)
                        return await window.api.query(
                            "personal_feed",
                            page,
                            offset,
                        );
                    if (feed == BEST_IN_REALMS)
                        return await window.api.query(
                            "hot_realm_posts",
                            realm,
                            page,
                            offset,
                        );
                    if (feed == HOT)
                        return await window.api.query(
                            "hot_posts",
                            realm,
                            page,
                            offset,
                            // only enable noise filtering outside of realms
                            !currentRealm(),
                        );
                    if (feed == REALMS)
                        return await window.api.query(
                            "realms_posts",
                            page,
                            offset,
                        );
                    return await window.api.query(
                        "last_posts",
                        realm,
                        page,
                        offset,
                        feed ==
                            NEW /* apply noise filter on NEW but not on ALL */,
                    );
                }}
            />
        </>
    );
};

export const TagCloud = ({
    heartbeat,
    realm,
}: {
    heartbeat: any;
    realm: string;
}) => {
    const tagsToDisplay = bigScreen() ? 60 : 30;
    const muted = new Set();
    muted.add("taggr");

    const shuffle = (array: any[], seed = 1) => {
        const seededRandom = (max: number) => {
            // Simple LCG (Linear Congruential Generator)
            seed = (seed * 1664525 + 1013904223) % 2147483648;
            return (seed / 2147483648) * max;
        };

        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(seededRandom(i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    };

    const [tags, setTags] = React.useState<[string, number][]>();
    const loadTags = async () => {
        // We only load tags inside realms, otherwise we use the backend cache.
        let tags = realm
            ? (await window.api.query<[string, number][]>(
                  "recent_tags",
                  realm,
                  200,
              )) || []
            : window.backendCache.recent_tags;
        tags = tags.filter((val) => !muted.has(val[0].toLowerCase()));
        tags.sort((a, b) => (a[1] > b[1] ? -1 : 1));
        tags = shuffle(tags.slice(0, tagsToDisplay));
        const occurences = tags.map(([_, N]) => Number(N));
        const max = Math.max(...occurences);
        const min = Math.min(...occurences);
        tags = tags.map(([tag, N]) => [tag, (N - min) / (max - min)]);

        setTags(tags);
    };
    React.useEffect(() => {
        loadTags();
    }, [heartbeat]);
    if (tags == null) return <Loading />;
    if (tags.length == 0) return null;
    return (
        <div id="tag_cloud" className="row_container top_spaced">
            {tags.map(([tag, scale]) => {
                const shiftGrade = 20;
                const vertShift =
                    scale < 0.5
                        ? Math.floor(Math.random() * shiftGrade) -
                          shiftGrade / 2
                        : 0;
                return (
                    <a
                        key={tag}
                        className="tag"
                        href={`#/feed/${tag}`}
                        style={{
                            position: "relative",
                            bottom: `${vertShift}px`,
                            transform: `scale(${3 * scale + 0.6})`,
                            margin: `${scale * 1.2}rem`,
                            opacity: `${0.5 + scale * 0.5}`,
                            zIndex: Math.ceil(scale * 10),
                        }}
                    >
                        {tag}
                    </a>
                );
            })}
        </div>
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
