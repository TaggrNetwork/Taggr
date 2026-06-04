import * as React from "react";
import {
    ICPAccountBalance,
    timeAgo,
    hoursTillNext,
    HeadBar,
    icpCode,
    IcpAccountLink,
    USD_PER_XDR,
    show,
    sizeMb,
    showCycles,
} from "./common";
import { Content } from "./content";
import {
    ActiveUser,
    Box,
    Canister,
    Cash,
    CashCoin,
    Comment,
    Credits,
    Fire,
    Gear,
    HourGlass,
    Online,
    Post,
    Realm,
    StorageCanister,
    Treasury,
    User,
} from "./icons";
import { UserList } from "./user_resolve";

type Log = {
    timestamp: BigInt;
    level: string;
    message: string;
};

export const Dashboard = ({}) => {
    const [logs, setLogs] = React.useState<Log[]>([]);

    React.useEffect(() => {
        window.api.query<Log[]>("logs").then((logs) => {
            if (!logs) return;
            let tmp: [Log, number][] = logs.map((entry, i) => [entry, i]);
            tmp.sort(([log1, pos1], [log2, pos2]) => {
                const result = Number(log2.timestamp) - Number(log1.timestamp);
                if (result == 0) return pos2 - pos1;
                return result;
            });
            setLogs(tmp.map(([value]) => value));
        });
    }, []);

    const { config, stats } = window.backendCache;
    return (
        <>
            <HeadBar title="DASHBOARD" shareLink="dashboard" />
            <div className="text_centered vertically_spaced">
                <div className="dynamic_table">
                    <div className="db_cell">
                        <label>
                            <User /> USERS
                        </label>
                        {show(stats.users)}
                    </div>
                    <div className="db_cell">
                        <label>
                            <ActiveUser /> ACTIVE (7d)
                        </label>
                        {show(stats.active_users)}
                    </div>
                    <div className="db_cell">
                        <label>
                            <Online /> ONLINE
                        </label>
                        {show(
                            Math.max(1, window.backendCache.stats.users_online),
                        )}
                    </div>
                    <div className="db_cell">
                        <label>
                            <Post /> POSTS
                        </label>
                        {show(stats.posts)}
                    </div>
                    <div className="db_cell">
                        <label>
                            <Comment /> COMMENTS
                        </label>
                        {show(stats.comments)}
                    </div>
                    <div className="db_cell">
                        <label>
                            <Realm /> REALMS
                        </label>
                        {show(stats.realms)}
                    </div>
                    <div className="db_cell">
                        <label>
                            <Box /> APP STATE
                        </label>
                        {sizeMb(
                            stats.state_size +
                                stats.buckets.reduce(
                                    (acc, [, size]) => acc + size,
                                    0,
                                ),
                        )}
                    </div>
                    <div className="db_cell">
                        <label>
                            <Treasury />{" "}
                            <IcpAccountLink
                                address={stats.account}
                                label={"ICP TREASURY"}
                            />
                        </label>
                        <ICPAccountBalance
                            address={stats.account}
                            decimals={0}
                        />
                    </div>
                    <div className="db_cell">
                        <label>
                            <HourGlass /> DISTRIBUTION
                        </label>
                        <code className="xx_large_text">{`${hoursTillNext(
                            604800000000000,
                            stats.last_weekly_chores,
                        )}h`}</code>
                    </div>
                    <div className="db_cell">
                        <label>
                            <Credits /> CREDITS SUPPLY
                        </label>
                        {show(stats.credits)}
                    </div>
                    <div className="db_cell">
                        <label>
                            <Fire /> WEEK'S REVENUE
                        </label>
                        {show(
                            (Number(stats.burned_credits) /
                                config.credits_per_xdr) *
                                USD_PER_XDR,
                            "$",
                            "prefix",
                        )}
                    </div>
                    <div className="db_cell">
                        <label>
                            <CashCoin /> REWARDS PAID
                        </label>
                        {icpCode(stats.total_rewards_shared, 0)}
                    </div>
                    <div className="db_cell">
                        <label>
                            <Cash /> REVENUE PAID
                        </label>
                        {icpCode(stats.total_revenue_shared, 0)}
                    </div>
                </div>
            </div>
            <div className="spaced">
                <hr />
                <div className="text_centered">
                    <h2>
                        <Canister classNameArg="right_half_spaced" />
                        <a
                            href={`https://dashboard.internetcomputer.org/canister/${window.backendCache.stats.canister_id}`}
                        >
                            MAIN CANISTER
                        </a>
                    </h2>
                    <div className="dynamic_table">
                        <div className="db_cell">
                            <label>
                                <Box /> STATE
                            </label>
                            {sizeMb(stats.state_size)}
                        </div>
                        <div className="db_cell">
                            <label>
                                <Credits /> CYCLES
                            </label>
                            {showCycles(Number(stats.canister_cycle_balance))}
                        </div>
                        <div className="db_cell">
                            <label>
                                <Fire /> DAILY BURN
                            </label>
                            {showCycles(Number(stats.canister_cycle_burn))}
                        </div>
                        <div className="db_cell">
                            <label>
                                <Gear /> LAST UPGRADE
                            </label>
                            <a
                                className="xx_large_text"
                                href={`#/post/${stats.last_release.post_id}`}
                            >
                                {stats.last_release.commit.slice(0, 8)}
                            </a>
                            <code>{timeAgo(stats.last_release.timestamp)}</code>
                        </div>
                    </div>
                </div>
                {stats.buckets.map(([bucket_id, size, cycles, burn], i) => (
                    <div key={bucket_id} className="text_centered">
                        <hr />
                        <h2>
                            <StorageCanister classNameArg="right_half_spaced" />
                            <a
                                href={`https://dashboard.internetcomputer.org/canister/${bucket_id}`}
                            >
                                STORAGE {i}
                            </a>
                        </h2>
                        <div className="dynamic_table">
                            <div className="db_cell">
                                <label>
                                    <Box /> STATE
                                </label>
                                {sizeMb(size)}
                            </div>
                            <div className="db_cell">
                                <label>
                                    <Credits /> CYCLES
                                </label>
                                {showCycles(cycles)}
                            </div>
                            <div className="db_cell">
                                <label>
                                    <Fire /> DAILY BURN
                                </label>
                                {showCycles(burn)}
                            </div>
                        </div>
                    </div>
                ))}
                <hr />
                <div>
                    <h2>STALWARTS</h2>
                    <UserList ids={stats.stalwarts} />
                </div>
                <hr />
                <h2>LOGS</h2>
                <table className="dashboard_logs">
                    <tbody>
                        {logs.map(({ timestamp, level, message }, i) => {
                            const date = new Date(Number(timestamp) / 1000000);
                            return (
                                <tr key={i}>
                                    <td>
                                        <code>{shortDate(date)}</code>
                                    </td>
                                    <td>{level2icon(level)}</td>
                                    <td>
                                        <Content value={message} />
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </>
    );
};

const shortDate = (date: Date) => {
    let options: any = {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
        second: "numeric",
    };
    return new Intl.DateTimeFormat("default", options).format(date);
};

const level2icon = (level: string) => {
    switch (level) {
        case "INFO":
            return "ℹ️";
        case "DEBUG":
            return "🤖";
        case "WARN":
            return "⚠️";
        case "ERROR":
            return "🔴";
        case "CRITICAL":
            return "💥";
        default:
            return "❓";
    }
};
