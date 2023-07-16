import * as React from "react";
import {
    timeAgo,
    NotFound,
    ToggleButton,
    commaSeparated,
    Loading,
    RealmSpan,
    HeadBar,
    userList,
    bigScreen,
    tokenBalance,
    FlagButton,
    ReportBanner,
    UserLink,
    percentage,
    ShareButton,
} from "./common";
import { Content } from "./content";
import { Journal } from "./icons";
import { PostFeed } from "./post_feed";
import { Cycles, YinYan } from "./icons";

export const Profile = ({ handle }) => {
    // loadingStatus: 0 initial, 1 loaded, -1 not found
    const [profile, setProfile] = React.useState({ loadingStatus: 0 });
    const [allEndorsememnts, setAllEndorsements] = React.useState(false);
    const [fullAccounting, setFullAccounting] = React.useState(false);
    const [tab, setTab] = React.useState("LAST");

    const updateState = async () => {
        const profile = await api.query("user", [handle]);
        if (!profile) {
            setProfile({ loadingStatus: -1 });
            return;
        }
        profile.loadingStatus = 1;
        setProfile(profile);
    };

    React.useEffect(() => {
        if (profile.loadingStatus == 0) {
            updateState();
            return;
        }
        let { id, name } = profile;
        const user_id = parseInt(handle);
        const lhs = isNaN(user_id) ? name : id;
        if (handle != lhs) updateState();
    }, [handle]);

    switch (profile.loadingStatus) {
        case 0:
            return <Loading />;
        case -1:
            return <NotFound />;
    }
    const { feed_page_size } = backendCache.config;
    const user = api._user;
    const showReport =
        profile.report && !profile.report.closed && user && user.stalwart;
    const karma_from_last_posts = Object.entries(
        profile.karma_from_last_posts,
    ).filter(([_, karma]) => karma >= 0);
    karma_from_last_posts.sort(([_id1, e1], [_id2, e2]) => e2 - e1);
    const endorsementsTotal = karma_from_last_posts.reduce(
        (acc, [_, karma]) => acc + karma,
        0,
    );

    const title = (
        <div className="text_centered vertically_spaced">
            {["LAST", "TAGS", "REWARDED"].map((id) => (
                <button
                    key={id}
                    onClick={() => setTab(id)}
                    className={
                        "medium_text " + (tab == id ? "active" : "unselected")
                    }
                >
                    {id}
                </button>
            ))}
        </div>
    );

    return (
        <>
            <HeadBar
                title={profile.name}
                button1={
                    <button
                        onClick={() =>
                            (location.href = `/#/journal/${profile.name}`)
                        }
                    >
                        <Journal />
                    </button>
                }
                button2={
                    user ? (
                        <ToggleButton
                            classNameArg="left_half_spaced right_half_spaced"
                            currState={() =>
                                user.followees.includes(profile.id)
                            }
                            toggler={() =>
                                api
                                    .call("toggle_following_user", profile.id)
                                    .then(api._reloadUser)
                            }
                        />
                    ) : null
                }
                menu={true}
                content={
                    <div className="row_container">
                        <FlagButton
                            id={profile.id}
                            domain="misbehaviour"
                            text={true}
                        />
                        <ShareButton
                            url={`/user/${profile.name}`}
                            classNameArg="left_half_spaced max_width_col"
                            text={true}
                        />
                    </div>
                }
            />
            {showReport && (
                <ReportBanner
                    id={profile.id}
                    reportArg={profile.report}
                    domain="misbehaviour"
                />
            )}
            <UserInfo profile={profile} />
            <div className="spaced">
                <h2>
                    Karma from last {backendCache.config.feed_page_size * 3}{" "}
                    posts
                </h2>
                <div className="dynamic_table">
                    {(allEndorsememnts
                        ? karma_from_last_posts
                        : karma_from_last_posts.slice(0, bigScreen() ? 8 : 6)
                    ).map(([userId, karma]) => (
                        <div key={userId} className="db_cell">
                            {<UserLink id={userId} />}
                            <code>{percentage(karma, endorsementsTotal)}</code>
                        </div>
                    ))}
                </div>
                {!allEndorsememnts && (
                    <button
                        className="top_spaced"
                        onClick={() => setAllEndorsements(true)}
                    >
                        SHOW ALL
                    </button>
                )}
            </div>
            <hr />
            {profile.accounting.length > 0 && (
                <>
                    <div className="spaced">
                        <h2>Karma and Cycles Changes</h2>
                        <table
                            style={{ width: "100%" }}
                            className={`monospace ${
                                bigScreen() ? "" : "small_text"
                            }`}
                        >
                            <tbody>
                                {(fullAccounting
                                    ? profile.accounting
                                    : profile.accounting.slice(0, 10)
                                ).map(([timestamp, type, delta, log], i) => (
                                    <tr
                                        className="stands_out"
                                        key={type + log + i}
                                    >
                                        <td>{timeAgo(timestamp)}</td>
                                        <td
                                            style={{
                                                color:
                                                    delta > 0 ? "green" : "red",
                                                textAlign: "right",
                                            }}
                                            className="no_wrap"
                                        >
                                            {delta > 0 ? "+" : ""}
                                            {delta}{" "}
                                            {type == "KRM" ? (
                                                <YinYan />
                                            ) : (
                                                <Cycles />
                                            )}
                                        </td>
                                        <td style={{ textAlign: "right" }}>
                                            {linkPost(log)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {!fullAccounting && (
                            <button onClick={() => setFullAccounting(true)}>
                                SHOW ALL
                            </button>
                        )}
                    </div>
                    <hr />
                </>
            )}
            {trusted(profile) && !stalwart(profile) && !isBot(profile) && (
                <>
                    <div className="spaced">
                        <h2>Stalwart Progress</h2>
                        <div className="dynamic_table">
                            <div className="db_cell monospace">
                                KARMA NEEDED
                                <code>
                                    {Math.max(
                                        0,
                                        stalwartMinKarma() - profile.karma,
                                    )}
                                </code>
                            </div>
                            <div className="db_cell monospace">
                                AGE NEEDED
                                <code>
                                    {Math.ceil(
                                        Math.max(
                                            0,
                                            (backendCache.config
                                                .min_stalwart_account_age_weeks *
                                                7 *
                                                daySeconds -
                                                secondsSince(
                                                    profile.timestamp,
                                                )) /
                                                daySeconds /
                                                7,
                                        ),
                                    )}{" "}
                                    WEEKS
                                </code>
                            </div>
                            <div className="db_cell monospace">
                                ACTIVITY NEEDED
                                <code>
                                    {Math.max(
                                        0,
                                        backendCache.config
                                            .min_stalwart_activity_weeks -
                                            profile.active_weeks,
                                    )}{" "}
                                    WEEKS
                                </code>
                            </div>
                        </div>
                    </div>
                    <hr />
                </>
            )}
            {!trusted(profile) && (
                <>
                    <div className="spaced">
                        <h2>Bootcamp Progress</h2>
                        <div className="dynamic_table">
                            <div className="db_cell monospace">
                                KARMA NEEDED
                                <code>
                                    {Math.max(
                                        0,
                                        backendCache.config
                                            .trusted_user_min_karma -
                                            profile.karma,
                                    )}
                                </code>
                            </div>
                            <div className="db_cell monospace">
                                TIME LEFT
                                <code>
                                    {Math.ceil(
                                        Math.max(
                                            0,
                                            backendCache.config
                                                .trusted_user_min_age_weeks *
                                                7 -
                                                secondsSince(
                                                    profile.timestamp,
                                                ) /
                                                    daySeconds,
                                        ),
                                    )}{" "}
                                    DAYS
                                </code>
                            </div>
                        </div>
                    </div>
                    <hr />
                </>
            )}
            <PostFeed
                title={title}
                feedLoader={async (page) => {
                    if (profile.loadingStatus != 1) return;
                    if (tab == "TAGS")
                        return await api.query("user_tags", profile.name, page);
                    if (tab == "REWARDED")
                        return await api.query(
                            "rewarded_posts",
                            profile.id.toString(),
                            page,
                        );
                    return await api.query(
                        "user_posts",
                        profile.id.toString(),
                        page,
                    );
                }}
                heartbeat={profile.id + tab}
            />
        </>
    );
};

export const UserInfo = ({ profile }) => {
    const [followeesVisible, setFolloweesVisibility] = React.useState(false);
    const [followersVisible, setFollowersVisibility] = React.useState(false);
    const placeholder = (status, unfold, label, content) =>
        status ? (
            <div className="small_text">{content}</div>
        ) : (
            <a
                className="x_large_text"
                href="#"
                onClick={(e) => {
                    e.preventDefault();
                    unfold(true);
                }}
            >{`${label}`}</a>
        );
    const followees =
        profile.followees.length > 0 ? (
            <div className="db_cell">
                FOLLOWS
                {placeholder(
                    followeesVisible,
                    setFolloweesVisibility,
                    profile.followees.length,
                    userList(profile.followees),
                )}
            </div>
        ) : null;
    const followers =
        profile.followers.length > 0 ? (
            <div className="db_cell">
                FOLLOWERS
                {placeholder(
                    followersVisible,
                    setFollowersVisibility,
                    profile.followers.length,
                    userList(profile.followers),
                )}
            </div>
        ) : null;
    const feeds =
        profile.feeds.length > 0
            ? commaSeparated(
                  profile.feeds.map((feed) => {
                      let feedRepr = feed.join("+");
                      return (
                          <a key={feed} href={`#/feed/${feedRepr}`}>
                              {feedRepr}
                          </a>
                      );
                  }),
              )
            : null;
    const realms =
        profile.realms.length > 0 ? (
            <div
                className="row_container top_spaced"
                style={{ alignItems: "center" }}
            >
                {profile.realms.map((name) => (
                    <RealmSpan
                        key={name}
                        name={name}
                        onClick={() => (location.href = `/#/realm/${name}`)}
                        classNameArg="clickable padded_rounded right_half_spaced top_half_spaced"
                    />
                ))}
            </div>
        ) : null;
    const inviter = profile.invited_by;

    return (
        <div className="spaced">
            {getLabels(profile)}
            {profile.about && (
                <Content classNameArg="larger_text " value={profile.about} />
            )}
            <hr />
            <div className="dynamic_table monospace">
                <div className="db_cell">
                    KARMA
                    <code>{profile.karma.toLocaleString()}</code>
                </div>
                <div className="db_cell">
                    NEW KARMA
                    <code className="accent">
                        {profile.rewarded_karma.toLocaleString()}
                    </code>
                </div>
                <div className="db_cell">
                    CYCLES
                    <code>{`${profile.cycles.toLocaleString()}`}</code>
                </div>
                <div className="db_cell">
                    JOINED
                    <span>{`${timeAgo(profile.timestamp)}`}</span>
                </div>
                <div className="db_cell">
                    LAST ACTIVE
                    <span>{`${timeAgo(profile.last_activity, "date")}`}</span>
                </div>
                <div className="db_cell">
                    ACTIVE WEEKS
                    <code>{profile.active_weeks.toLocaleString()}</code>
                </div>
                <div className="db_cell">
                    POSTS
                    <code>{profile.num_posts.toLocaleString()}</code>
                </div>
                <div className="db_cell">
                    TOKENS
                    <code>{tokenBalance(profile.balance)}</code>
                </div>
                {followees}
                {followers}
                {inviter && (
                    <div className="db_cell">
                        INVITED BY
                        <span>
                            <a
                                href={`/#/user/${inviter}`}
                            >{`${backendCache.users[inviter]}`}</a>
                        </span>
                    </div>
                )}
            </div>
            <hr />
            {(feeds || realms) && (
                <>
                    <h2>INTERESTS</h2>
                    {feeds}
                    {realms}
                    <hr />
                </>
            )}
        </div>
    );
};

export const getLabels = (profile) => {
    const labels = [];
    // Account created before end of 2022
    if (isBot(profile)) {
        labels.push(["BOT", "RoyalBlue"]);
    } else if (profile.timestamp < 1672500000000000000) {
        labels.push(["OG", "PaleVioletRed"]);
    }
    if (profile.stalwart) {
        labels.push(["STALWART", "Salmon"]);
    } else if (!trusted(profile)) {
        labels.push(["BOOTCAMP", "OliveDrab"]);
    }
    if (profile.active_weeks > 12) {
        labels.push(["FREQUENTER", "SlateBlue"]);
    }
    if (api._user && profile.followees.includes(api._user.id)) {
        labels.push(["FOLLOWS YOU", "SeaGreen"]);
    }
    if (
        secondsSince(profile.last_activity) / daySeconds >
        backendCache.config.revenue_share_activity_weeks * 7
    ) {
        labels.push(["INACTIVE", "White"]);
    }

    if (labels.length == 0) return null;
    return (
        <div className="small_text monospace">
            {labels.map(([text, color]) => (
                <span
                    key={text}
                    style={{
                        borderRadius: "3px",
                        padding: "0.2em",
                        color: "black",
                        background: color,
                        marginRight: "0.3em",
                    }}
                >
                    {text}
                </span>
            ))}
        </div>
    );
};

const daySeconds = 24 * 3600;

const secondsSince = (val) =>
    (Number(new Date()) - parseInt(val) / 1000000) / 1000;

export const trusted = (profile) =>
    profile.karma >= backendCache.config.trusted_user_min_karma &&
    secondsSince(profile.timestamp) >=
        backendCache.config.trusted_user_min_age_weeks * 7 * daySeconds;

const isBot = (profile) => profile.controllers.find((p) => p.length == 27);

const stalwart = (profile) =>
    !isBot(profile) &&
    secondsSince(profile.timestamp) >=
        backendCache.config.min_stalwart_account_age_weeks * 7 * daySeconds &&
    profile.active_weeks >= backendCache.config.min_stalwart_activity_weeks &&
    profile.karma >= stalwartMinKarma();

const stalwartMinKarma = () =>
    Math.min(
        backendCache.config.proposal_rejection_penalty,
        backendCache.karma[backendCache.stats.stalwarts.at(-1)] || 0,
    );

const linkPost = (line) => {
    const [prefix, id] = line.split(" post ");
    if (id) {
        return (
            <span>
                {prefix} post <a href={`#/post/${id}`}>{id}</a>
            </span>
        );
    } else return line;
};
