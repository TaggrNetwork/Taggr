import * as React from "react";
import { Content } from "./content";
import { PostFeed } from "./post_feed";
import { Dashboard } from "./dashboard";
import { Search } from "./search";
import {
    bigScreen,
    currentRealm,
    Loading,
    RealmSpan,
    setTitle,
} from "./common";
import { New, User, Fire } from "./icons";

export const Landing = ({ heartbeat }) => {
    const user = api._user;
    const realm = currentRealm();
    const FEED_KEY = `${realm}_feed`;
    const [feed, setFeed] = React.useState(
        localStorage.getItem(FEED_KEY) || "HOT"
    );
    const headline = `# Welcome aboard\nof a **fully decentralized** social network.\n\n[WHITE PAPER &#x279C;](/#/whitepaper)`;
    const title = (
        <div className="text_centered vertically_spaced">
            {[
                { icon: <New />, id: "NEW" },
                { icon: <Fire />, id: "HOT" },
                user && !realm && { icon: <User />, id: "FOLLOWED" },
            ]
                .filter(Boolean)
                .map(({ icon, id }) => (
                    <button
                        key={id}
                        onClick={() => {
                            localStorage.setItem(FEED_KEY, id);
                            setFeed(id);
                        }}
                        className={
                            "medium_text " +
                            (feed == id ? "active" : "unselected")
                        }
                    >
                        {icon} {id}
                    </button>
                ))}
        </div>
    );
    return (
        <>
            {!user && !realm && (
                <Content value={headline} classNameArg="spaced text_centered" />
            )}
            <Search />
            {!user && !realm && (
                <>
                    <Dashboard />
                    <RealmsDashboard />
                </>
            )}
            <TagCloud
                size={bigScreen() ? 60 : 30}
                heartbeat={heartbeat}
                realm={realm}
            />
            <PostFeed
                heartbeat={heartbeat + feed}
                title={title}
                grid={true}
                feedLoader={async (page) => {
                    setTitle(feed);
                    if (feed == "FOLLOWED")
                        return await api.query(
                            "personal_feed",
                            user.id,
                            page,
                            false
                        );
                    if (feed == "HOT")
                        return await api.query("hot_posts", realm, page);
                    else
                        return await api.query(
                            "last_posts",
                            realm,
                            page,
                            false
                        );
                }}
            />
        </>
    );
};

const RealmsDashboard = () => {
    const realmNames = Object.keys(backendCache.realms);
    return (
        <div className="vertically_spaced text_centered">
            <div
                className="row_container"
                style={{ margin: "0.5em", marginBottom: "1em" }}
            >
                {realmNames.slice(0, 10).map((name) => (
                    <RealmSpan
                        key={name}
                        col={backendCache.realms[name][0]}
                        name={name}
                        styleArg={{ padding: "1em" }}
                        onClick={() => (location.href = `/#/realm/${name}`)}
                        classNameArg="clickable max_width_col medium_text monospace padded_rounded marginized"
                    />
                ))}
            </div>
            <a href="#/realms">ALL REALMS &#x279C;</a>
        </div>
    );
};

export const TagCloud = ({ size, heartbeat, realm }) => {
    const [tags, setTags] = React.useState(null);
    const loadTags = async () => {
        let tags = await api.query("recent_tags", realm, size);
        const occurences = tags.map(([_, N]) => parseInt(N));
        const min = Math.min(...occurences);
        const max = Math.max(...occurences);
        const bucket = (max - min) / 10;
        tags = tags.map(([tag, N]) => [
            tag,
            Math.ceil((parseInt(N) - min) / bucket),
        ]);
        tags.sort((a, b) => (a[0] > b[0] ? 1 : -1));
        setTags(tags);
    };
    React.useEffect(() => {
        loadTags();
    }, [heartbeat]);
    if (tags == null) return <Loading />;
    return (
        <div id="tag_cloud" className="row_container vertically_spaced">
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
