import * as React from "react";
import { PostFeed } from "./post_feed";
import { Search } from "./search";
import {
    bigScreen,
    currentRealm,
    Loading,
    RealmSpan,
    setTitle,
} from "./common";
import { New, User, Fire, Realm } from "./icons";

export const Landing = () => {
    const user = window.user;
    const realm = currentRealm();
    const [feed, setFeed] = React.useState(
        (user && user.settings.tab) || "HOT",
    );
    const labels: [JSX.Element, string][] = [
        [<New />, "NEW"],
        [<Fire />, "HOT"],
    ];
    if (user && !realm) {
        labels.push([<User />, "FOLLOWED"]);
        if (user.realms.length > 0) labels.push([<Realm />, "REALMS"]);
    }

    const title = (
        <div className="text_centered vertically_spaced small_text">
            {labels.map(([icon, id]: [JSX.Element, string]) => (
                <button
                    key={id}
                    onClick={() => {
                        user.settings.tab = id;
                        window.api.call<any>(
                            "update_user_settings",
                            JSON.stringify(user.settings),
                        );
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
                <div className="vertically_spaced text_centered">
                    <h1>WELCOME ABOARD</h1>
                    <span>
                        To the Future of Decentralized Social Networking.
                    </span>
                    <br />
                    <br />
                    <a href="#/whitepaper">WHITE PAPER</a>
                    &nbsp;&middot;&nbsp;
                    <a href="#/tokens">TOKENS</a>
                    &nbsp;&middot;&nbsp;
                    <a href="#/dashboard">DASHBOARD</a>
                </div>
            )}
            <Search />
            {!user && !realm && (
                <>
                    <RealmsDashboard />
                </>
            )}
            <TagCloud
                size={bigScreen() ? 60 : 30}
                heartbeat={feed}
                realm={realm}
            />
            <PostFeed
                heartbeat={feed}
                refreshRateSecs={10 * 60}
                title={title}
                feedLoader={async (page) => {
                    setTitle(feed);
                    if (feed == "FOLLOWED")
                        return await window.api.query(
                            "personal_feed",
                            page,
                            false,
                        );
                    if (feed == "HOT")
                        return await window.api.query("hot_posts", realm, page);
                    if (feed == "REALMS")
                        return await window.api.query("realms_posts", page);
                    else
                        return await window.api.query(
                            "last_posts",
                            realm,
                            page,
                            false,
                        );
                }}
            />
        </>
    );
};

const RealmsDashboard = () => {
    const realmNames = Object.keys(window.backendCache.realms);
    return (
        <div className="vertically_spaced text_centered">
            <div
                className="row_container"
                style={{ margin: "0.5em", marginBottom: "1em" }}
            >
                {realmNames.slice(0, 10).map((name) => (
                    <RealmSpan
                        key={name}
                        col={window.backendCache.realms[name][0]}
                        name={name}
                        styleArg={{ padding: "1em" }}
                        onClick={() => (location.href = `/#/realm/${name}`)}
                        classNameArg="clickable max_width_col medium_text padded_rounded marginized"
                    />
                ))}
                <a className="vcentered padded_rounded" href="#/realms">
                    MORE &#x279C;
                </a>
            </div>
        </div>
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
        const min = Math.min(...occurences);
        const max = Math.max(...occurences);
        const bucket = (max - min) / 10;
        tags = tags.map(([tag, N]) => [
            tag,
            Math.ceil((Number(N) - min) / bucket),
        ]);
        tags.sort((a, b) => (a[0] > b[0] ? 1 : -1));
        setTags(tags);
    };
    React.useEffect(() => {
        loadTags();
    }, [heartbeat]);
    if (tags == null) return <Loading />;
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
