import * as React from "react";
import {
    timeAgo,
    NotFound,
    ToggleButton,
    commaSeparated,
    Loading,
    HeadBar,
    bigScreen,
    tokenBalance,
    FlagButton,
    ReportBanner,
    ShareButton,
    ButtonWithLoading,
    popUp,
    RealmList,
    noiseControlBanner,
    setTitle,
    pfpUrl,
    showPopUp,
    domain,
} from "./common";
import { Content } from "./content";
import { Journal } from "./icons";
import { PostFeed } from "./post_feed";
import { PostId, User, UserId } from "./types";
import { Principal } from "@dfinity/principal";
import { UserLink, UserList } from "./user_resolve";

export const Profile = ({ handle }: { handle: string }) => {
    const [status, setStatus] = React.useState(0);
    const [profile, setProfile] = React.useState({} as User);
    const [tab, setTab] = React.useState("LAST");

    const updateState = async () => {
        const profile = await window.api.query<User>("user", domain(), [
            handle,
        ]);
        if (!profile) {
            setStatus(-1);
            return;
        }
        setStatus(1);
        setProfile(profile);
        setTitle(`${profile.name}'s profile`);
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
                title={
                    <span className="row_container vcentered">
                        <img
                            className="pfp"
                            height="48"
                            width="48"
                            src={pfpUrl(profile.id)}
                        />
                        {profile.name}
                    </span>
                }
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
                button2={<FollowButton id={profile.id} />}
                menu={true}
                burgerTestId="profile-burger-menu"
                content={
                    <div className="row_container">
                        <ShareButton
                            url={`user/${profile.name}`}
                            classNameArg="max_width_col"
                            text={true}
                        />
                        <>
                            {user && user.id != profile.id && (
                                <>
                                    <FlagButton id={profile.id} text={true} />
                                    <ToggleButton
                                        offLabel="BLOCK"
                                        onLabel="UNBLOCK"
                                        classNameArg="max_width_col"
                                        currState={() =>
                                            user.blacklist.includes(profile.id)
                                        }
                                        toggler={() =>
                                            window.api
                                                .call(
                                                    "toggle_blacklist",
                                                    profile.id,
                                                )
                                                .then(window.reloadUser)
                                        }
                                    />
                                    <ToggleButton
                                        offLabel="MUTE"
                                        onLabel="UNMUTE"
                                        classNameArg="max_width_col"
                                        currState={() =>
                                            user.filters.users.includes(
                                                profile.id,
                                            )
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
                                                showPopUp("error", result.Err);
                                                return;
                                            }
                                            window.reloadUser();
                                            await updateState();
                                        }}
                                    />
                                </>
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
                                                    profile.settings.open_chat,
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
                    </div>
                }
            />
            {showReport && profile.report && (
                <ReportBanner id={profile.id} reportArg={profile.report} />
            )}
            <UserInfo profile={profile} />
            {profile.deactivated ? (
                <div className="text_centered vertically_spaced">
                    This account is deactivated.
                </div>
            ) : (
                <PostFeed
                    title={title}
                    useList={true}
                    feedLoader={async (page: number, offset: PostId) => {
                        if (status != 1) return null;
                        if (tab == "TAGS")
                            return await window.api.query(
                                "user_tags",
                                domain(),
                                profile.name,
                                page,
                                offset,
                            );
                        if (tab == "REWARDED")
                            return await window.api.query(
                                "rewarded_posts",
                                domain(),
                                profile.id.toString(),
                                page,
                                offset,
                            );
                        return await window.api.query(
                            "user_posts",
                            domain(),
                            profile.id.toString(),
                            page,
                            offset,
                        );
                    }}
                    heartbeat={profile.id + tab}
                />
            )}
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
            {window.user && profile.blacklist.includes(window.user.id) && (
                <div className="banner vertically_spaced">
                    This user has blocked you
                </div>
            )}
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
                {(profile.mode == "Rewards" || profile.rewards < 0) && (
                    <div className="db_cell">
                        REWARDS
                        <code className="accent">
                            {profile.rewards.toLocaleString()}
                        </code>
                    </div>
                )}
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
                {profile.followees.length > 0 && (
                    <div className="db_cell">
                        FOLLOWS
                        {placeholder(
                            // we need to subtract 1 because every user follows themselves by default
                            profile.followees.length - 1,
                            <>
                                <h2>Follows</h2>
                                {followeeList(
                                    profile.followees.filter(
                                        (id) => id != profile.id,
                                    ),
                                )}
                            </>,
                        )}
                    </div>
                )}
                {profile.followers.length > 0 && (
                    <div className="db_cell">
                        FOLLOWERS
                        {placeholder(
                            profile.followers.length,
                            <>
                                <h2>Followers</h2>
                                <UserList ids={profile.followers} />
                            </>,
                        )}
                    </div>
                )}
                {profile.feeds.length > 0 && (
                    <div className="db_cell">
                        FEEDS
                        {placeholder(
                            profile.feeds.length,
                            commaSeparated(
                                profile.feeds.map((feed) => {
                                    let feedRepr = feed.join("+");
                                    return (
                                        <a
                                            key={feedRepr}
                                            href={`#/feed/${feedRepr}`}
                                        >
                                            {feedRepr}
                                        </a>
                                    );
                                }),
                            ),
                        )}
                    </div>
                )}
                {profile.realms.length > 0 && (
                    <div className="db_cell">
                        JOINED REALMS
                        {placeholder(
                            profile.realms.length,
                            <RealmList
                                classNameArg="centered"
                                ids={profile.realms}
                            />,
                        )}
                    </div>
                )}
                {profile.controlled_realms.length > 0 && (
                    <div className="db_cell">
                        CONTROLS REALMS
                        {placeholder(
                            profile.controlled_realms.length,
                            <RealmList
                                classNameArg="centered"
                                ids={profile.controlled_realms}
                            />,
                        )}
                    </div>
                )}
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
                <div className="db_cell">
                    CREDITS
                    <code>{`${profile.cycles.toLocaleString()}`}</code>
                </div>
            </div>
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
            <div key={id} className="row_container vcentered bottom_spaced">
                <UserLink id={id} classNameArg="max_width_col" />
                {window.user && window.user.id != id && (
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
                )}
            </div>
        ))}
    </>
);

const daySeconds = 24 * 3600;

const secondsSince = (val: BigInt) =>
    (Number(new Date()) - Number(val) / 1000000) / 1000;

const isBot = (profile: User) =>
    profile.controllers.find((p) => p.length == 27);

export const FollowButton = ({ id }: { id: UserId }) => {
    const user = window.user;
    return !user || user.id == id ? null : (
        <ToggleButton
            offLabel="FOLLOW"
            onLabel="UNFOLLOW"
            classNameArg="left_half_spaced right_half_spaced"
            currState={() => user.followees.includes(id)}
            toggler={() =>
                window.api
                    .call("toggle_following_user", id)
                    .then(window.reloadUser)
            }
        />
    );
};
