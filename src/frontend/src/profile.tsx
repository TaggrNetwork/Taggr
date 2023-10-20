import * as React from "react";
import {
    timeAgo,
    NotFound,
    ToggleButton,
    commaSeparated,
    Loading,
    HeadBar,
    userList,
    bigScreen,
    tokenBalance,
    FlagButton,
    ReportBanner,
    UserLink,
    percentage,
    ShareButton,
    ButtonWithLoading,
    realmList,
} from "./common";
import { Content } from "./content";
import { Journal } from "./icons";
import { PostFeed } from "./post_feed";
import { Cycles, YinYan } from "./icons";
import { User, UserId } from "./types";

export const Profile = ({ handle }: { handle: string }) => {
    const [status, setStatus] = React.useState(0);
    const [profile, setProfile] = React.useState({} as User);
    const [allEndorsememnts, setAllEndorsements] = React.useState(false);
    const [fullAccounting, setFullAccounting] = React.useState(false);
    const [tab, setTab] = React.useState("LAST");

    const updateState = async () => {
        const profile = await window.api.query<User>("user", [handle]);
        if (!profile) {
            setStatus(-1);
            return;
        }
        setStatus(1);
        setProfile(profile);
    };

    React.useEffect(() => {
        if (status == 0) {
            updateState();
            return;
        }
        let { id, name }: { id: number; name: string } = profile;
        const user_id = parseInt(handle);
        const lhs = isNaN(user_id) ? name : id;
        if (handle != lhs) updateState();
    }, [handle]);

    switch (status) {
        case 0:
            // @ts-ignore
            return <Loading />;
        case -1:
            return <NotFound />;
    }
    const user = window.user;
    const showReport =
        profile.report && !profile.report.closed && user && user.stalwart;
    const karma_from_last_posts: [UserId, number][] = Object.entries(
        profile.karma_from_last_posts
    )
        .filter(([_, karma]) => karma >= 0)
        .map(([user_id, karma]) => [parseInt(user_id), karma]);
    karma_from_last_posts.sort(([_id1, e1], [_id2, e2]) => e2 - e1);
    const endorsementsTotal = karma_from_last_posts.reduce(
        (acc, [_, karma]) => acc + karma,
        0
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
                        title={`${profile.name}'s journal`}
                        onClick={() =>
                            (location.href = `/#/journal/${profile.name}`)
                        }
                    >
                        {
                            // @ts-ignore
                            <Journal />
                        }
                    </button>
                }
                button2={
                    user ? (
                        <ToggleButton
                            offLabel="FOLLOW"
                            onLabel="UNFOLLOW"
                            classNameArg="left_half_spaced right_half_spaced"
                            currState={() =>
                                user.followees.includes(profile.id)
                            }
                            toggler={() =>
                                window.api
                                    .call("toggle_following_user", profile.id)
                                    .then(window.reloadUser)
                            }
                        />
                    ) : undefined
                }
                menu={true}
                content={
                    <div className="row_container">
                        <ShareButton
                            url={`/user/${profile.name}`}
                            classNameArg="left_half_spaced max_width_col"
                            text={true}
                        />
                        {user && (
                            <>
                                <FlagButton
                                    id={profile.id}
                                    domain="misbehaviour"
                                    text={true}
                                />
                                {user.id != profile.id && (
                                    <ButtonWithLoading
                                        label="SEND CYCLES"
                                        classNameArg="max_width_col"
                                        onClick={async () => {
                                            const amount = parseInt(
                                                prompt(
                                                    `Enter the amount (fee: 1 cycle)`
                                                ) || ""
                                            );
                                            if (!amount) return;
                                            if (
                                                !confirm(
                                                    `You are transferring ${amount} cycles to @${profile.name}`
                                                )
                                            )
                                                return;
                                            let result =
                                                await window.api.call<any>(
                                                    "transfer_cycles",
                                                    profile.id,
                                                    amount
                                                );
                                            if ("Err" in result) {
                                                alert(`Error: ${result.Err}`);
                                                return;
                                            }
                                            window.reloadUser();
                                            await updateState();
                                        }}
                                    />
                                )}
                                <ToggleButton
                                    offLabel="MUTE"
                                    onLabel="UNMUTE"
                                    classNameArg="max_width_col"
                                    currState={() =>
                                        user.filters.users.includes(profile.id)
                                    }
                                    toggler={() =>
                                        window.api
                                            .call(
                                                "toggle_filter",
                                                "user",
                                                profile.id.toString()
                                            )
                                            .then(window.reloadUser)
                                    }
                                />
                            </>
                        )}
                    </div>
                }
            />
            {showReport && profile.report && (
                <ReportBanner
                    id={profile.id}
                    reportArg={profile.report}
                    domain="misbehaviour"
                />
            )}
            <UserInfo profile={profile} />
            {karma_from_last_posts.length > 0 && (
                <>
                    <div className="spaced">
                        <h2>
                            Karma from last{" "}
                            {window.backendCache.config.feed_page_size * 3}{" "}
                            posts
                        </h2>

                        <div className="dynamic_table">
                            {(allEndorsememnts
                                ? karma_from_last_posts
                                : karma_from_last_posts.slice(
                                      0,
                                      bigScreen() ? 8 : 6
                                  )
                            ).map(([userId, karma]) => (
                                <div key={userId} className="db_cell">
                                    {<UserLink id={userId} />}
                                    <code>
                                        {percentage(karma, endorsementsTotal)}
                                    </code>
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
                </>
            )}
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
                                                <YinYan classNameArg="" />
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
                                        stalwartMinKarma() - profile.karma
                                    )}
                                </code>
                            </div>
                            <div className="db_cell monospace">
                                AGE NEEDED
                                <code>
                                    {Math.ceil(
                                        Math.max(
                                            0,
                                            (window.backendCache.config
                                                .min_stalwart_account_age_weeks *
                                                7 *
                                                daySeconds -
                                                secondsSince(
                                                    profile.timestamp
                                                )) /
                                                daySeconds /
                                                7
                                        )
                                    )}{" "}
                                    WEEKS
                                </code>
                            </div>
                            <div className="db_cell monospace">
                                ACTIVITY NEEDED
                                <code>
                                    {Math.max(
                                        0,
                                        window.backendCache.config
                                            .min_stalwart_activity_weeks -
                                            profile.active_weeks
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
                                        window.backendCache.config
                                            .trusted_user_min_karma -
                                            profile.karma
                                    )}
                                </code>
                            </div>
                            <div className="db_cell monospace">
                                TIME LEFT
                                <code>
                                    {Math.ceil(
                                        Math.max(
                                            0,
                                            window.backendCache.config
                                                .trusted_user_min_age_weeks *
                                                7 -
                                                secondsSince(
                                                    profile.timestamp
                                                ) /
                                                    daySeconds
                                        )
                                    )}{" "}
                                    DAYS
                                </code>
                            </div>
                        </div>
                    </div>
                    <hr />
                </>
            )}
            {
                // @ts-ignore
                <PostFeed
                    title={title}
                    useList={true}
                    feedLoader={async (page: number) => {
                        if (status != 1) return;
                        if (tab == "TAGS")
                            return await window.api.query(
                                "user_tags",
                                profile.name,
                                page
                            );
                        if (tab == "REWARDED")
                            return await window.api.query(
                                "rewarded_posts",
                                profile.id.toString(),
                                page
                            );
                        return await window.api.query(
                            "user_posts",
                            profile.id.toString(),
                            page
                        );
                    }}
                    heartbeat={profile.id + tab}
                />
            }
        </>
    );
};

export const UserInfo = ({ profile }: { profile: User }) => {
    const [followeesVisible, setFolloweesVisibility] = React.useState(false);
    const [followersVisible, setFollowersVisibility] = React.useState(false);
    const placeholder = (
        status: boolean,
        unfold: any,
        label: number,
        content: any
    ) =>
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
                    userList(profile.followees)
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
                    userList(profile.followers)
                )}
            </div>
        ) : null;
    const feeds =
        profile.feeds.length > 0
            ? commaSeparated(
                  profile.feeds.map((feed) => {
                      let feedRepr = feed.join("+");
                      return (
                          <a key={feedRepr} href={`#/feed/${feedRepr}`}>
                              {feedRepr}
                          </a>
                      );
                  })
              )
            : null;
    const realms =
        profile.realms.length > 0 ? (
            <div
                className="row_container top_spaced"
                style={{ alignItems: "center" }}
            >
                {realmList(profile.realms)}
            </div>
        ) : null;
    const inviter = profile.invited_by;
    const filters = profile.filters;

    return (
        <div className="spaced">
            {profile.previous_names.length > 0 && (
                <div className="bottom_spaced">
                    AKA:{" "}
                    {commaSeparated(
                        profile.previous_names.map((handle) => <b>{handle}</b>)
                    )}
                </div>
            )}
            {getLabels(profile)}
            {profile.about && (
                // @ts-ignore
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
                    <span>{`${timeAgo(profile.last_activity, true)}`}</span>
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
                {inviter != undefined && (
                    <div className="db_cell">
                        INVITED BY
                        <span>
                            <a
                                href={`/#/user/${inviter}`}
                            >{`${window.backendCache.users[inviter]}`}</a>
                        </span>
                    </div>
                )}
            </div>
            <hr />
            {(feeds || realms) && (
                <>
                    <h2>Interests</h2>
                    {feeds}
                    {realms}
                    <hr />
                </>
            )}
            {filters.users.length +
                filters.tags.length +
                filters.realms.length >
                0 && (
                <>
                    <h2>Muted</h2>
                    <div className="bottom_spaced">
                        {userList(filters.users)}
                    </div>
                    <div className="bottom_spaced">
                        {realmList(filters.realms)}
                    </div>
                    <div className="bottom_spaced">
                        {commaSeparated(
                            filters.tags.map((tag) => (
                                <a key={tag} href={`#/feed/${tag}`}>
                                    {tag}
                                </a>
                            ))
                        )}
                    </div>
                    <hr />
                </>
            )}
        </div>
    );
};

export const getLabels = (profile: User) => {
    const labels = [];
    // Account created before end of 2022
    if (isBot(profile)) {
        labels.push(["BOT", "RoyalBlue"]);
    } else if (Number(profile.timestamp) < 1672500000000000000) {
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
    if (
        window.user &&
        profile.followees.includes(window.user.id) &&
        window.user.id != profile.id
    ) {
        labels.push(["FOLLOWS YOU", "SeaGreen"]);
    }
    if (
        secondsSince(profile.last_activity) / daySeconds >
        window.backendCache.config.revenue_share_activity_weeks * 7
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

const secondsSince = (val: BigInt) =>
    (Number(new Date()) - Number(val) / 1000000) / 1000;

export const trusted = (profile: User) =>
    profile.karma >= window.backendCache.config.trusted_user_min_karma &&
    secondsSince(profile.timestamp) >=
        window.backendCache.config.trusted_user_min_age_weeks * 7 * daySeconds;

const isBot = (profile: User) =>
    profile.controllers.find((p) => p.length == 27);

const stalwart = (profile: User) =>
    !isBot(profile) &&
    secondsSince(profile.timestamp) >=
        window.backendCache.config.min_stalwart_account_age_weeks *
            7 *
            daySeconds &&
    profile.active_weeks >=
        window.backendCache.config.min_stalwart_activity_weeks &&
    profile.karma >= stalwartMinKarma();

const stalwartMinKarma = () =>
    Math.min(
        window.backendCache.config.proposal_rejection_penalty,
        window.backendCache.karma[
            window.backendCache.stats.stalwarts.at(-1) || 0
        ] || 0
    );

const linkPost = (line: string) => {
    const [prefix, id] = line.split(" post ");
    if (id) {
        return (
            <span>
                {prefix} post <a href={`#/post/${id}`}>{id}</a>
            </span>
        );
    } else return line;
};
