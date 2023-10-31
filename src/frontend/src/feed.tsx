import * as React from "react";
import { currentRealm, HeadBar, setTitle } from "./common";
import { ToggleButton } from "./common";
import { PostFeed } from "./post_feed";
import { UserId } from "./types";

const userId = (handle: string) => {
    const users = window.backendCache.users;
    const username = handle.replace("@", "").toLowerCase();
    for (const i in users) {
        if (users[i].toLowerCase() == username) return parseInt(i);
    }
    return -1;
};

export const Feed = ({ params }: { params: string[] }) => {
    const [filter, setFilter] = React.useState(params);
    React.useEffect(() => setFilter(params), [params]);
    return (
        <div className="column_container">
            <FeedBar params={params} callback={setFilter} />
            <PostFeed
                feedLoader={async (page: number) => {
                    const tags: string[] = [],
                        users: UserId[] = [];
                    filter.forEach((token) => {
                        if (token.startsWith("@")) users.push(userId(token));
                        else tags.push(token);
                    });
                    return await window.api.query(
                        "posts_by_tags",
                        currentRealm(),
                        tags,
                        users,
                        page,
                    );
                }}
                heartbeat={filter.concat(params).join("")}
            />
        </div>
    );
};

const FeedExtender = ({
    filterVal,
    setFilterVal,
    refilter,
    filter,
}: {
    filterVal: string;
    setFilterVal: (arg: string) => void;
    refilter: () => void;
    filter: string[];
}) => {
    const [extending, setExtending] = React.useState(false);
    return (
        <div className="top_half_spaced row_container flex_ended">
            {extending && (
                <div className="row_container max_width_col">
                    <input
                        type="text"
                        className="medium_text max_width_col"
                        value={filterVal}
                        onChange={(e) => setFilterVal(e.target.value)}
                        placeholder="Enter @user or #tag"
                    />
                    <button
                        className="right_half_spaced"
                        onClick={() => {
                            refilter();
                            setExtending(false);
                        }}
                    >
                        DONE
                    </button>
                </div>
            )}
            {!extending && (
                <button
                    className="max_width_col"
                    onClick={() => setExtending(!extending)}
                >
                    EXTEND
                </button>
            )}
            {!extending && window.user && (
                <>
                    <ToggleButton
                        classNameArg="max_width_col"
                        offLabel="FOLLOW"
                        onLabel="UNFOLLOW"
                        currState={() => contains(window.user.feeds, filter)}
                        toggler={() =>
                            window.api
                                .call("toggle_following_feed", filter)
                                .then(window.reloadUser)
                        }
                    />
                    {filter.length == 1 && (
                        <ToggleButton
                            offLabel="MUTE"
                            onLabel="UNMUTE"
                            classNameArg="max_width_col"
                            currState={() =>
                                window.user.filters.tags.includes(filter[0])
                            }
                            toggler={() =>
                                window.api
                                    .call("toggle_filter", "tag", filter[0])
                                    .then(window.reloadUser)
                            }
                        />
                    )}
                </>
            )}
        </div>
    );
};

const FeedBar = ({
    params,
    callback,
}: {
    params: string[];
    callback: (arg: string[]) => void;
}) => {
    const [filter, setFilter] = React.useState(params);
    const [filterVal, setFilterVal] = React.useState("");

    React.useEffect(() => setFilter(params), [params]);

    const refilter = () => {
        if (!filterVal) return;
        // we need to create a new array for react to notice
        const newFilter = filter.map((val) => val);
        newFilter.push(filterVal.replace("#", ""));
        setFilterVal("");
        setFilter(newFilter);
        callback(newFilter);
    };

    const renderToken = (token: string) =>
        token.startsWith("@") ? (
            <a
                key={token}
                className="tag"
                href={`#/user/${token.replace("@", "")}`}
            >
                {token}
            </a>
        ) : (
            <a key={token} className="tag" href={`#/feed/${token}`}>
                #{token}
            </a>
        );

    filter.sort();
    setTitle(`feed: ${filter.join(" + ")}`);
    return (
        <HeadBar
            title={filter.map(renderToken).reduce((prev, curr) => (
                <>
                    {prev} + {curr}
                </>
            ))}
            shareLink={`feed/${filter.join("+")}`}
            shareTitle={`Hash-tag feed on ${window.backendCache.config.name}`}
            content={
                <FeedExtender
                    filterVal={filterVal}
                    setFilterVal={setFilterVal}
                    filter={filter}
                    refilter={refilter}
                />
            }
            menu={true}
        />
    );
};

const contains = (feeds: string[][], filter: string[]) => {
    filter = filter.map((t) => t.toLowerCase());
    OUTER: for (let i in feeds) {
        const feed = feeds[i];
        if (feed.length != filter.length) continue;
        for (let j in feed) {
            const tag = feed[j];
            if (!filter.includes(tag)) continue OUTER;
        }
        return true;
    }
    return false;
};
