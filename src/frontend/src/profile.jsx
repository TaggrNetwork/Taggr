import * as React from "react";
import { timeAgo, NotFound, ToggleButton, commaSeparated, Loading, RealmSpan, HeadBar, userList, bigScreen, tokenBalance, FlagButton, ReportBanner, UserLink, percentage } from './common';
import {Content} from "./content";
import {Journal} from "./icons";
import {PostFeed} from "./post_feed";
import {Cycles, YinYan} from "./icons";

export const Profile = ({handle}) => {
    // loadingStatus: 0 initial, 1 loaded, -1 not found
    const [profile, setProfile] = React.useState({ loadingStatus: 0 });
    const [allEndorsememnts, setAllEndorsements] = React.useState(false);
    const [fullAccounting, setFullAccounting] = React.useState(false);

    const updateState = async () => {
        const profile = await api.query("user", [handle]);
        if (!profile) {
            setProfile({ loadingStatus: -1 });
            return;
        }
        profile.loadingStatus = 1;
        profile.posts.reverse();
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
    const showReport = profile.report && !profile.report.closed && user && user.stalwart;
    const karma_from_last_posts = Object.entries(profile.karma_from_last_posts).filter(([_, karma]) => karma >= 0);
    karma_from_last_posts.sort(([_id1, e1], [_id2, e2]) => e2 - e1);
    const endorsementsTotal = karma_from_last_posts.reduce((acc, [_, karma]) => acc + karma, 0);

    return <>
        <HeadBar title={<UserName profile={profile} />} shareLink={`user/${profile.id}`}
            content={<div className="row_container">
                <FlagButton id={profile.id} domain="misbehaviour" />
                <button className="left_half_spaced" onClick={() => location.href= `/#/journal/${profile.name}`}><Journal /></button>
                {user && <ToggleButton classNameArg="left_half_spaced max_width_col"
                    currState={() => user.followees.includes(profile.id)}
                    toggler={() => api.call("toggle_following_user", profile.id).then(api._reloadUser)} />}
            </div>} />
        {showReport && <ReportBanner id={profile.id} reportArg={profile.report} domain="misbehaviour" />}
        <UserInfo profile={profile} />
        <div className="spaced">
            <h2>Karma from last {backendCache.config.feed_page_size * 3} posts</h2>
            <div className="dynamic_table">
                {(allEndorsememnts ? karma_from_last_posts : karma_from_last_posts.slice(0, bigScreen() ? 8 : 6)).map(([userId, karma]) =>
                <div key={userId} className="db_cell">
                    {<UserLink id={userId} />}
                    <code>{percentage(karma, endorsementsTotal)}</code>
                </div>)}
            </div>
            {!allEndorsememnts && <button className="top_spaced" onClick={() => setAllEndorsements(true)}>SHOW ALL</button>}
        </div>
        <hr />
        {profile.accounting.length > 0 && <>
            <div className="spaced">
                <h2>Karma and Cycles Changes</h2>
                <table style={{width: "100%"}} className={`monospace ${bigScreen() ? "" : "small_text"}`}>
                    <tbody>
                        {(fullAccounting ? profile.accounting : profile.accounting.slice(0,10))
                                .map(([timestamp, type, delta, log], i) => 
                                    <tr className="stands_out" key={type+log+i}>
                                        <td>{timeAgo(timestamp)}</td>
                                        <td style={{color: delta > 0 ? "green" : "red", textAlign: "right"}} className="no_wrap">{delta > 0 ? "+" : ""}{delta} {type == "KRM" ? <YinYan /> : <Cycles />}</td>
                                        <td style={{textAlign: "right"}}>{linkPost(log)}</td>
                                    </tr>)}
                    </tbody>
                </table>
                {!fullAccounting && <button onClick={() => setFullAccounting(true)}>SHOW ALL</button>}
            </div>
            <hr />
        </>}
        {trusted(profile) && !stalwart(profile) && !isBot(profile) && <>
            <div className="spaced">
                <h2>Stalwart Progress</h2>
                <div className="dynamic_table">
                    <div className="db_cell monospace">
                        KARMA NEEDED
                        <code>{Math.max(0, stalwartMinKarma() - profile.karma)}</code>
                    </div>
                    <div className="db_cell monospace">
                        AGE NEEDED
                        <code>{Math.ceil(Math.max(0, 
                            (backendCache.config.min_stalwart_account_age_weeks * 7 * day - 
                                (Number(new Date()) - parseInt(profile.timestamp) / 1000000)) / day / 7
                        ))} WEEKS</code>
                    </div>
                    <div className="db_cell monospace">
                        ACTIVITY NEEDED
                        <code>{Math.max(0, backendCache.config.min_stalwart_activity_weeks - profile.active_weeks)} WEEKS</code>
                    </div>
                </div>
            </div>
            <hr />
        </>}
        {!trusted(profile) && <>
            <div className="spaced">
                <h2>Bootcamp Progress</h2>
                <div className="dynamic_table">
                    <div className="db_cell monospace">
                        KARMA NEEDED
                        <code>{Math.max(0, backendCache.config.trusted_user_min_karma - profile.karma)}</code>
                    </div>
                    <div className="db_cell monospace">
                        TIME LEFT
                        <code>{Math.ceil(Math.max(0, 
                            (backendCache.config.trusted_user_min_age_weeks * 7 * day - 
                                (Number(new Date()) - parseInt(profile.timestamp) / 1000000)) / day
                        ))} DAYS</code>
                    </div>
                </div>
            </div>
            <hr />
        </>}
        {profile.posts.length > 0 && <h2 className="spaced">Latest posts</h2>}
        <PostFeed feedLoader={async page => {
            if (profile.loadingStatus != 1) return;
            let post_ids = profile.posts;
            const offset = page * feed_page_size;
            post_ids = post_ids.slice(offset, offset + feed_page_size);
            return await api.query("posts", post_ids);
        }} heartbeat={profile.id} />
    </>;
};

export const UserName = ({profile}) => {
    return <>
        {profile.name}
        {profile.stalwart && <sup className="small_text">⚔️</sup>}
        {isBot(profile) && <sup className="small_text">🤖</sup>} 
        {!trusted(profile) && <sup className="small_text">*️⃣</sup>} 
    </>;
}

export const UserInfo = ({profile}) => {
    const [followeesVisible, setFolloweesVisibility] = React.useState(false);
    const [followersVisible, setFollowersVisibility] = React.useState(false);
    const placeholder = (status, unfold, label, content) => status 
        ? <div className="small_text">{content}</div>
        : <a className="x_large_text" href="#" onClick={e => { e.preventDefault(); unfold(true) }}>{`${label}`}</a>;
    const followees = profile.followees.length > 0
        ? <div className="db_cell">
            FOLLOWS
            {placeholder(followeesVisible, setFolloweesVisibility, profile.followees.length, userList(profile.followees))}
        </div>
        : null;
    const followers = profile.followers.length > 0
        ? <div className="db_cell">
            FOLLOWERS
            {placeholder(followersVisible, setFollowersVisibility, profile.followers.length, userList(profile.followers))}
        </div>
        : null;
    const feeds = profile.feeds.length > 0
        ? commaSeparated(profile.feeds.map(feed => {
            let feedRepr = feed.join("+");
            return <a key={feed} href={`#/feed/${feedRepr}`}>{feedRepr}</a>
        }))
        : null;
    const realms = profile.realms.length > 0 
        ? <div className="row_container top_spaced" style={{alignItems: "center"}}>{profile.realms.map(name => 
            <RealmSpan key={name} name={name}  onClick={() => location.href = `/#/realm/${name}`}
                classNameArg={`clickable padded_rounded right_half_spaced top_half_spaced ${profile.current_realm == name ? "current_realm" : ""}`} />)}
        </div>
        : null;
    const inviter = profile.invited_by;
    return <div className="spaced">
        {profile.about && <>
            <Content classNameArg="larger_text " value={profile.about} />
            <hr />
        </>}
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
                <code>{profile.posts.length.toLocaleString()}</code>
            </div>
            <div className="db_cell">
                TOKENS
                <code>{tokenBalance(profile.balance)}</code>
            </div>
            {followees}
            {followers}
            {inviter && <div className="db_cell">
                INVITED BY
                <span><a href={`/#/user/${inviter}`}>{`${backendCache.users[inviter]}`}</a></span>
            </div>}
        </div>
        <hr />
        {(feeds || realms) && <>
            <h2>INTERESTS</h2>
            {feeds}
            {realms}
            <hr />
        </>}
    </div>;
};

const day = 24 * 3600 * 1000;

const trusted = profile => profile.karma >= backendCache.config.trusted_user_min_karma &&
    (Number(new Date()) - parseInt(profile.timestamp) / 1000000) >=
    backendCache.config.trusted_user_min_age_weeks * 7 * day;

const isBot = profile => profile.controllers.find(p => p.length == 27);

const stalwart = profile => !isBot(profile) && 
    (Number(new Date()) - parseInt(profile.timestamp) / 1000000) >=
    backendCache.config.min_stalwart_account_age_weeks * 7 * day && 
    profile.active_weeks >= backendCache.config.min_stalwart_activity_weeks &&
    profile.karma >= stalwartMinKarma();

const stalwartMinKarma = () => Math.min(backendCache.config.proposal_rejection_penalty, backendCache.karma[backendCache.stats.stalwarts.at(-1)]);


const linkPost = line => {
    const [prefix, id] = line.split(" post ");
    if (id) {
        return <span>{prefix} post <a href={`#/post/${id}`}>{id}</a></span>;
    } else return line;
};
