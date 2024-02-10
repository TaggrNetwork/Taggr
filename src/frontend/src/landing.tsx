import * as React from "react";
import { PostFeed } from "./post_feed";
import { Search } from "./search";
import { bigScreen, currentRealm, Loading } from "./common";
import { New, User, Bars, Gem, Balloon, Document, Fire, Realm } from "./icons";
import { PostId } from "./types";

export const Landing = () => {
    const user = window.user;
    const realm = currentRealm();
    const [feed, setFeed] = React.useState(
        (user && user.settings.tab) || "TRENDING",
    );
    let labels: [JSX.Element, string][] = [
        [<New />, "NEW"],
        [<Fire />, "TRENDING"],
    ];
    if (!realm) {
        if (user) {
            // If user didn't configure noise filters, hide NEW
            const { age_days, balance, num_followers } = user.filters.noise;
            if (age_days == 0 && balance == 0 && num_followers == 0)
                labels = labels.slice(1);
            labels.push([
                <User classNameArg="vertically_aligned" />,
                "PERSONAL",
            ]);
            if (user.realms.length > 0) labels.push([<Realm />, "REALMS"]);
        } else {
            labels = labels.slice(1);
            labels.push([<Realm />, "BEST IN REALMS"]);
        }
    }

    const title = (
        <div className="text_centered vertically_spaced small_text">
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
                    className={feed == id ? "active" : "unselected"}
                >
                    {icon} {id}
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
            {!user && <Links />}
            <Search />
            <TagCloud
                size={bigScreen() ? 60 : 30}
                heartbeat={feed}
                realm={realm}
            />
            <PostFeed
                heartbeat={feed}
                refreshRateSecs={10 * 60}
                title={title}
                feedLoader={async (page: number, offset: PostId) => {
                    if (feed == "PERSONAL")
                        return await window.api.query(
                            "personal_feed",
                            page,
                            offset,
                        );
                    if (feed == "BEST IN REALMS")
                        return await window.api.query(
                            "hot_realm_posts",
                            realm,
                            page,
                            offset,
                        );
                    if (feed == "TRENDING")
                        return await window.api.query(
                            "hot_posts",
                            realm,
                            page,
                            offset,
                        );
                    if (feed == "REALMS")
                        return await window.api.query(
                            "realms_posts",
                            page,
                            offset,
                        );
                    else
                        return await window.api.query(
                            "last_posts",
                            realm,
                            page,
                            offset,
                            // only enable noise filtering outside of realms
                            !currentRealm(),
                        );
                }}
            />
        </>
    );
};

export const TagCloud = ({
    size,
    heartbeat,
    realm,
}: {
    size: number;
    heartbeat: any;
    realm: string;
}) => {
    const [tags, setTags] = React.useState<[string, number][]>();
    const loadTags = async () => {
        let tags =
            (await window.api.query<[string, number][]>(
                "recent_tags",
                realm,
                size,
            )) || [];
        const occurences = tags.map(([_, N]) => Number(N));
        const max = Math.max(...occurences);
        const min = Math.min(...occurences);
        tags = tags.map(([tag, N]) => [
            tag,
            Math.ceil(((N - min) / (max - min)) * 10),
        ]);
        tags.sort((a, b) => (a[0] > b[0] ? 1 : -1));
        setTags(tags);
    };
    React.useEffect(() => {
        loadTags();
    }, [heartbeat]);
    if (tags == null) return <Loading />;
    if (tags.length == 0) return null;
    return (
        <div id="tag_cloud" className="row_container ">
            {tags.map(([tag, size]) => (
                <a
                    key={tag}
                    className={`tag size${size}`}
                    href={`#/feed/${tag}`}
                >
                    {tag}
                </a>
            ))}
        </div>
    );
};

export const Links = ({}) => {
    return (
        <div
            className={`${
                bigScreen() ? "row_container icon_bar" : "dynamic_table tripple"
            } vertically_spaced spaced`}
        >
            <a title="NEW POSTS" className="icon_link" href="/#/posts">
                <New /> ALL NEW POSTS
            </a>
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
        </div>
    );
};
