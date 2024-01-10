import * as React from "react";
import {
    ICPAccountBalance,
    intFromBEBytes,
    timeAgo,
    hoursTillNext,
    HeadBar,
    userList,
    icpCode,
    IcpAccountLink,
    XDR_TO_USD,
    token,
    UserLink,
    MoreButton,
    bigScreen,
} from "./common";
import { Content } from "./content";
import {
    ActiveUser,
    Binary,
    Box,
    Canister,
    Canisters,
    Cash,
    CashCoin,
    Comment,
    Credits,
    Fire,
    Gear,
    HourGlass,
    Online,
    Post,
    StorageCanister,
    Treasury,
    User,
} from "./icons";
import { UserId } from "./types";

const show = (val: number | BigInt, unit?: string, unit_position?: string) => (
    <code>
        {unit_position == "prefix" && unit}
        {val.toLocaleString()}
        {unit_position != "prefix" && unit}
    </code>
);

type Log = {
    timestamp: BigInt;
    level: string;
    message: string;
};

const TAB_KEY = "logs_tab";

export const Dashboard = ({}) => {
    const [logs, setLogs] = React.useState<Log[]>([]);
    const [rewards, setRewards] = React.useState<[UserId, number][]>([]);
    const [showAllRewards, setShowAllRewards] = React.useState(false);
    const [tab, setTab] = React.useState(
        Number(localStorage.getItem(TAB_KEY)) || 0,
    );

    React.useEffect(() => {
        window.api.query<Log[]>("logs").then((logs) => {
            if (!logs) return;
            logs.reverse();
            setLogs(logs);
        });
        window.api
            .query<[UserId, number][]>("tokens_to_mint")
            .then((rewards) => {
                if (!rewards) return;
                rewards.sort(
                    ([_id, balance1], [_id2, balance2]) => balance2 - balance1,
                );
                setRewards(rewards);
            });
    }, []);

    const logSelector = (
        <div className="text_centered vertically_spaced">
            {["SOCIAL", "TECHNICAL"].map((label, i) => (
                <button
                    key={label}
                    onClick={() => {
                        localStorage.setItem(TAB_KEY, i.toString());
                        setTab(i);
                    }}
                    className={
                        "medium_text " + (tab == i ? "active" : "unselected")
                    }
                >
                    {label}
                </button>
            ))}
        </div>
    );

    const { config, stats } = window.backendCache;
    return (
        <>
            <HeadBar title="DASHBOARD" shareLink="dashboard" />
            <div className="text_centered">
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
                            <Box /> APP STATE
                        </label>
                        {sizeMb(
                            stats.state_size +
                                stats.buckets.reduce(
                                    (acc, [, e]) => acc + e,
                                    0,
                                ),
                        )}
                    </div>
                    <div className="db_cell">
                        <label>
                            <Treasury />{" "}
                            <IcpAccountLink
                                address={stats.account}
                                label={"TREASURY"}
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
                            Number(stats.burned_credits) /
                                config.credits_per_xdr /
                                XDR_TO_USD,
                            "$",
                            "prefix",
                        )}
                    </div>
                    <div className="db_cell">
                        <label>
                            <CashCoin /> REWARDS SHARED
                        </label>
                        {icpCode(stats.total_rewards_shared, 0)}
                    </div>
                    <div className="db_cell">
                        <label>
                            <Cash /> REVENUE SHARED
                        </label>
                        {icpCode(stats.total_revenue_shared, 0)}
                    </div>
                </div>
            </div>
            <div className="spaced">
                <hr />
                <div className="text_centered">
                    <h2>
                        <Canisters classNameArg="right_half_spaced" /> CANISTERS
                    </h2>
                    <div className="dynamic_table">
                        <div className="db_cell">
                            <label>
                                <Canister />
                                <a
                                    className="left_half_spaced"
                                    href={`https://dashboard.internetcomputer.org/canister/${window.backendCache.stats.canister_id}`}
                                >
                                    MAIN
                                </a>
                            </label>
                            <div className="db_cell top_spaced bottom_spaced">
                                <label>
                                    <Box /> STATE
                                </label>{" "}
                                {sizeMb(stats.state_size)}
                            </div>
                            <div className="db_cell">
                                <label>
                                    <Credits /> CYCLES
                                </label>{" "}
                                {show(
                                    Number(stats.canister_cycle_balance) /
                                        10 ** 12,
                                    "T",
                                )}
                            </div>
                        </div>
                        {stats.buckets.map(([bucket_id, size], i) => (
                            <div key={bucket_id} className="db_cell">
                                <a
                                    href={`https://dashboard.internetcomputer.org/canister/${bucket_id}`}
                                >
                                    <StorageCanister classNameArg="right_half_spaced" />{" "}
                                    STORAGE {i}
                                </a>
                                <div className="db_cell top_spaced bottom_spaced">
                                    <label>
                                        <Box /> STATE
                                    </label>{" "}
                                    {sizeMb(size)}
                                </div>
                                <div className="db_cell">
                                    <label>
                                        <Credits /> CYCLES
                                    </label>{" "}
                                    <CycleBalance id={bucket_id} />
                                </div>
                            </div>
                        ))}
                        <div className="db_cell bottom_spaced">
                            <label>
                                <Gear /> LAST UPGRADE
                            </label>
                            <code>{timeAgo(stats.last_upgrade)}</code>
                        </div>
                        <div className="db_cell">
                            <label>
                                <Binary /> VERSION
                            </label>
                            <a className="xx_large_text" href="#/proposals">
                                {(stats.module_hash || "").slice(0, 8)}
                            </a>
                        </div>
                    </div>
                </div>
                <hr />
                <div>
                    <h2>STALWARTS</h2>
                    {userList(stats.stalwarts)}
                </div>
                <hr />
                <div>
                    <h2>
                        UPCOMING MINT (
                        {token(rewards.reduce((acc, [_, val]) => acc + val, 0))}
                        )
                    </h2>
                    <div
                        className={`dynamic_table ${
                            bigScreen() ? "" : "tripple"
                        } bottom_spaced`}
                    >
                        {(showAllRewards ? rewards : rewards.slice(0, 24)).map(
                            ([userId, tokens]) => (
                                <div key={userId} className="db_cell">
                                    <UserLink id={userId} />
                                    <code>{token(tokens)}</code>
                                </div>
                            ),
                        )}
                    </div>
                    {!showAllRewards && (
                        <MoreButton
                            callback={async () => setShowAllRewards(true)}
                        />
                    )}
                </div>
                <hr />
                {logSelector}
                <hr />
                <Content
                    value={logs
                        .filter(
                            ({ level }) =>
                                (tab == 0 && level == "INFO") ||
                                (tab > 0 && level != "INFO"),
                        )
                        .map(
                            ({ timestamp, level, message }) =>
                                `\`${shortDate(
                                    new Date(Number(timestamp) / 1000000),
                                )}\`: ${level2icon(level)} ${message}`,
                        )
                        .join("\n- - -\n")}
                />
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
            return "";
        case "DEBUG":
            return "";
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

const sizeMb = (size: number | BigInt) => (
    <code className="xx_large_text">
        {Math.ceil(Number(size) / 1024 / 1024).toLocaleString()} MB
    </code>
);

const CycleBalance = ({ id }: { id: string }) => {
    const [cycles, setCycles] = React.useState(-1);
    React.useEffect(() => {
        window.api
            .query_raw(id, "balance", new ArrayBuffer(0))
            .then((response: any) => setCycles(intFromBEBytes(response)));
    }, [id]);
    return (
        <code className="xx_large_text">{show(cycles / 10 ** 12, "T")}</code>
    );
};
