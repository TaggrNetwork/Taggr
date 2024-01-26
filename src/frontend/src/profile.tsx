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
    ShareButton,
    ButtonWithLoading,
    UserLink,
    popUp,
    RealmList,
    noiseControlBanner,
} from "./common";
import { Content } from "./content";
import { Journal } from "./icons";
import { PostFeed } from "./post_feed";
import { PostId, User, UserId } from "./types";
import { Principal } from "@dfinity/principal";

export const Profile = ({ handle }: { handle: string }) => {
    const [status, setStatus] = React.useState(0);
    const [profile, setProfile] = React.useState({} as User);
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
            return <Loading />;
        case -1:
            return <NotFound />;
    }
    const user = window.user;
    const showReport =
        profile.report && !profile.report.closed && user && user.stalwart;

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
                        <Journal />
                    </button>
                }
                button2={
                    user && user.id != profile.id ? (
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
                burgerTestId="profile-burger-menu"
                content={
                    <div className="row_container">
                        <ShareButton
                            url={`user/${profile.name}`}
                            classNameArg="max_width_col"
                            text={true}
                        />
                        {user && (
                            <>
                                <FlagButton
                                    id={profile.id}
                                    domain="misbehaviour"
                                    text={true}
                                />
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
                                                profile.id.toString(),
                                            )
                                            .then(window.reloadUser)
                                    }
                                />
                                {user.id != profile.id && (
                                    <ButtonWithLoading
                                        label="SEND CREDITS"
                                        classNameArg="max_width_col"
                                        onClick={async () => {
                                            const amount = parseInt(
                                                prompt(
                                                    `Enter the amount (fee: 1 credit)`,
                                                ) || "",
                                            );
                                            if (!amount) return;
                                            if (
                                                !confirm(
                                                    `You are transferring ${amount} credits to @${profile.name}`,
                                                )
                                            )
                                                return;
                                            let result =
                                                await window.api.call<any>(
                                                    "transfer_credits",
                                                    profile.id,
                                                    amount,
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
                                {profile.settings.open_chat && (
                                    <ButtonWithLoading
                                        label="OPEN CHAT"
                                        classNameArg="max_width_col"
                                        onClick={async () => {
                                            try {
                                                // Make sure it parses as cansiter id;
                                                let canister_id =
                                                    Principal.fromText(
                                                        profile.settings
                                                            .open_chat,
                                                    );
                                                const url = `https://oc.app/user/${canister_id.toString()}`;
                                                window.open(url, "_blank");
                                            } catch (e) {
                                                console.error(e);
                                            }
                                        }}
                                    />
                                )}
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
            <PostFeed
                title={title}
                useList={true}
                feedLoader={async (page: number, offset: PostId) => {
                    if (status != 1) return null;
                    if (tab == "TAGS")
                        return await window.api.query(
                            "user_tags",
                            profile.name,
                            page,
                            offset,
                        );
                    if (tab == "REWARDED")
                        return await window.api.query(
                            "rewarded_posts",
                            profile.id.toString(),
                            page,
                            offset,
                        );
                    return await window.api.query(
                        "user_posts",
                        profile.id.toString(),
                        page,
                        offset,
                    );
                }}
                heartbeat={profile.id + tab}
            />
        </>
    );
};

export const UserInfo = ({ profile }: { profile: User }) => {
    const placeholder = (label: number, content: any) =>
        status ? (
            <div className="small_text">{content}</div>
        ) : (
            <span
                className="clickable clickable_color"
                onClick={() => popUp(content)}
            >
                {label}
            </span>
        );
    const followees =
        profile.followees.length > 0 ? (
            <div className="db_cell">
                FOLLOWS
                {placeholder(
                    // we need to subtract 1 because every user follows themselves by default
                    profile.followees.length - 1,
                    <>
                        <h2>Follows</h2>
                        {followeeList(
                            profile.followees.filter((id) => id != profile.id),
                        )}
                    </>,
                )}
            </div>
        ) : null;
    const followers =
        profile.followers.length > 0 ? (
            <div className="db_cell">
                FOLLOWERS
                {placeholder(
                    profile.followers.length,
                    <>
                        <h2>Followers</h2>
                        {userList(profile.followers)}
                    </>,
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
                  }),
              )
            : null;
    const inviter = profile.invited_by;
    const filters = profile.filters;

    const donations = Object.entries(profile.karma_donations);
    donations.sort(([_, donation1], [_2, donation2]) => donation2 - donation1);
    const accountingList = (
        <>
            <h2>Rewards and Credits Accounting</h2>
            <table
                style={{ width: "100%" }}
                className={bigScreen() ? undefined : "small_text"}
            >
                <tbody>
                    {profile.accounting.map(
                        ([timestamp, type, delta, log], i) => (
                            <tr key={type + log + i}>
                                <td>{timeAgo(timestamp)}</td>
                                <td
                                    style={{
                                        color: delta > 0 ? "green" : "red",
                                    }}
                                    className="no_wrap"
                                >
                                    {delta > 0 ? "+" : ""}
                                    {delta}{" "}
                                    {type == "CRE" ? "credits" : "rewards"}
                                </td>
                                <td style={{ textAlign: "right" }}>
                                    {<Content post={false} value={log} />}
                                </td>
                            </tr>
                        ),
                    )}
                </tbody>
            </table>
        </>
    );

    const givenRewardsList = (
        <>
            <h2>Given Rewards</h2>
            <div
                className={`dynamic_table ${
                    bigScreen() ? "" : "tripple"
                } bottom_spaced`}
            >
                {donations.map(([userId, rewards]) => (
                    <div key={userId} className="db_cell">
                        <UserLink id={Number(userId)} />
                        <code>{rewards}</code>
                    </div>
                ))}
            </div>
        </>
    );

    return (
        <div className="spaced">
            {profile.previous_names.length > 0 && (
                <div className="bottom_spaced">
                    AKA:{" "}
                    {commaSeparated(
                        profile.previous_names.map((handle) => <b>{handle}</b>),
                    )}
                </div>
            )}
            {profile.about ? (
                <>
                    <Content classNameArg="larger_text" value={profile.about} />
                    <hr />
                </>
            ) : (
                <br />
            )}
            {getLabels(profile)}
            {noiseControlBanner("user", profile.filters.noise, window.user)}
            <div className="top_spaced dynamic_table">
                <div className="db_cell">
                    TOKENS
                    <a
                        className="xx_large_text"
                        href={`#/transactions/${profile.principal}`}
                    >
                        {tokenBalance(profile.balance)}
                    </a>
                </div>
                {profile.cold_balance > 0 && (
                    <div className="db_cell">
                        COLD WALLET
                        <a
                            className="xx_large_text"
                            href={`#/transactions/${profile.cold_wallet}`}
                        >
                            {tokenBalance(profile.cold_balance)}
                        </a>
                    </div>
                )}
                <div className="db_cell">
                    REWARDS
                    <code className="accent">
                        {profile.rewards.toLocaleString()}
                    </code>
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
                {followees}
                {followers}
                {profile.accounting.length > 0 && (
                    <div className="db_cell">
                        ACCOUNTING
                        <code
                            className="clickable clickable_color"
                            onClick={() => popUp(accountingList)}
                        >
                            {profile.accounting.length}
                        </code>
                    </div>
                )}
                {Object.keys(profile.karma_donations).length > 0 && (
                    <div className="db_cell">
                        GIVEN REWARDS
                        <code
                            className="clickable clickable_color"
                            onClick={() => popUp(givenRewardsList)}
                        >
                            {Object.keys(profile.karma_donations).length}
                        </code>
                    </div>
                )}
                <div className="db_cell">
                    CREDITS
                    <code>{`${profile.cycles.toLocaleString()}`}</code>
                </div>
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
            {(feeds || profile.realms.length > 0) && (
                <>
                    <h2>Interests</h2>
                    {feeds}
                    <RealmList classNameArg="top_spaced" ids={profile.realms} />
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
                        <RealmList
                            classNameArg="top_spaced"
                            ids={filters.realms}
                        />
                    </div>
                    <div className="bottom_spaced">
                        {commaSeparated(
                            filters.tags.map((tag) => (
                                <a key={tag} href={`#/feed/${tag}`}>
                                    {tag}
                                </a>
                            )),
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
        window.backendCache.config.voting_power_activity_weeks * 7
    ) {
        labels.push(["INACTIVE", "White"]);
    }

    if (labels.length == 0) return null;
    return (
        <div className="small_text">
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

const followeeList = (ids: UserId[]) => (
    <>
        {ids.map((id) => (
            <div key={id} className="stands_out row_container">
                <UserLink id={id} classNameArg="max_width_col" />
                <ToggleButton
                    offLabel="FOLLOW"
                    onLabel="UNFOLLOW"
                    classNameArg="left_half_spaced right_half_spaced"
                    currState={() => window.user.followees.includes(id)}
                    toggler={() =>
                        window.api
                            .call("toggle_following_user", id)
                            .then(window.reloadUser)
                    }
                />
            </div>
        ))}
    </>
);

const daySeconds = 24 * 3600;

const secondsSince = (val: BigInt) =>
    (Number(new Date()) - Number(val) / 1000000) / 1000;

const isBot = (profile: User) =>
    profile.controllers.find((p) => p.length == 27);
