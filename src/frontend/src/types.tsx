import { Backend } from "./api";
import { Root } from "react-dom/client";
import { AuthClient } from "@dfinity/auth-client";

export type PostId = number;
export type UserId = number;
export type RealmId = string;

export type ICP = {
    e8s: BigInt;
};

export type Poll = {
    options: string[];
    votes: { [option: number]: UserId[] };
    voters: UserId[];
    deadline: number;
    weighted_by_karma: { [key: number]: number };
    weighted_by_tokens: { [key: number]: number };
};

export type Summary = {
    title: string;
    description: string;
    items: string[];
};

export type Extension =
    | {
          ["Poll"]: Poll;
      }
    | {
          ["Repost"]: PostId;
      }
    | {
          ["Proposal"]: number;
      };

export type Reward = {
    receiver: string;
    votes: [number, number][];
    minted: number;
};

export type Release = {
    commit: string;
    hash: string;
};

export type Payload =
    | { ["Noop"]: any }
    | {
          ["Release"]: Release;
      }
    | {
          ["Fund"]: [string, number];
      }
    | {
          ["ICPTransfer"]: [number[], ICP];
      }
    | {
          ["AddRealmController"]: [RealmId, UserId];
      }
    | {
          ["Reward"]: Reward;
      };

export type Proposal = {
    id: number;
    proposer: UserId;
    timestamp: BigInt;
    post_id: PostId;
    status: "Open" | "Rejected" | "Executed" | "Cancelled";
    payload: Payload;
    bulletins: [UserId, boolean, number][];
    voting_power: number;
};

export type Realm = {
    last_root_post: number;
    cleanup_penalty: number;
    controllers: UserId[];
    description: string;
    filter: UserFilter;
    label_color: string;
    logo: string;
    num_members: number;
    num_posts: number;
    theme: string;
    whitelist: UserId[];
    last_update: number;
    last_setting_update: number;
    revenue: number;
};

export type Post = {
    id: PostId;
    parent?: PostId;
    watchers: UserId[];
    children: PostId[];
    reposts: PostId[];
    user: UserId;
    userObject: { id: UserId; name: string; rewards: number };
    report?: Report;
    body: string;
    effBody: string;
    reactions: { [id: number]: UserId[] };
    files: { [id: string]: [number, number] };
    patches: [BigInt, string][];
    tips: [UserId, BigInt][];
    hashes: string[];
    realm?: string;
    timestamp: BigInt;
    extension: Extension;
    tree_size: number;
    tree_update: BigInt;
};

export type BlogTitle = {
    author: string;
    created: BigInt;
    length: number;
};

export type Account = {
    owner: string;
    subaccount: number[];
};

export type Transaction = {
    timestamp: number;
    from: Account;
    to: Account;
    amount: number;
    fee: number;
    memo?: number[];
};

type Filters = {
    users: UserId[];
    tags: string[];
    realms: string[];
    noise: UserFilter;
};

export type Predicate =
    | {
          ["ReportOpen"]: PostId;
      }
    | {
          ["UserReportOpen"]: UserId;
      }
    | {
          ["Proposal"]: PostId;
      };

export type Notification =
    | {
          ["Generic"]: string;
      }
    | {
          ["WatchedPostEntries"]: [PostId, PostId[]];
      }
    | {
          ["Conditional"]: [string, Predicate];
      }
    | {
          ["NewPost"]: [string, PostId];
      };

export type UserFilter = {
    age_days: number;
    safe: boolean;
    balance: number;
    num_followers: number;
    downvotes: number;
};

export type User = {
    name: string;
    id: UserId;
    account: string;
    invites_budget: number;
    show_posts_in_realms: boolean;
    treasury_e8s: BigInt;
    principal: string;
    bookmarks: number[];
    last_activity: BigInt;
    governance: boolean;
    settings: {
        [key: string]: string;
    };
    realms: string[];
    previous_names: string[];
    report?: Report;
    last_post_report?: Report;
    stalwart: boolean;
    followees: UserId[];
    followers: UserId[];
    feeds: string[][];
    accounting: [number, string, number, string][];
    timestamp: BigInt;
    active_weeks: number;
    invited_by?: UserId;
    about: string;
    rewards: number;
    cycles: number;
    num_posts: number;
    balance: number;
    cold_balance: number;
    cold_wallet: string;
    controllers: string[];
    karma_donations: { [key: UserId]: number };
    downvotes: { [key: UserId]: number };
    filters: Filters;
    notifications: { [key: number]: [Notification, boolean] };
};

export type Report = {
    reason: string;
    reporter: UserId;
    confirmed_by: UserId[];
    rejected_by: UserId[];
    closed: boolean;
    timestamp: bigint;
};

export type Theme = { [name: string]: any };

declare global {
    interface Window {
        ic: any;
        authClient: AuthClient;
        stackRoot: Root;
        resetUI: () => void;
        reloadUser: () => Promise<void>;
        reloadCache: () => Promise<void>;
        setUI: (force?: boolean) => void;
        lastActivity: Date;
        lastVisit: BigInt;
        api: Backend;
        mainnet_api: Backend;
        principalId: string;
        realm: string;
        user: User;
        scrollUpButton: HTMLElement;
        lastSavedUpgrade: number;
        uiInitialized: boolean;
        backendCache: {
            users: { [name: UserId]: string };
            rewards: { [name: UserId]: number };
            recent_tags: string[];
            realms_data: { [name: string]: [string, boolean, UserFilter] };
            stats: {
                fees_burned: number;
                volume_day: number;
                volume_week: number;
                minting_ratio: number;
                users: number;
                active_users: number;
                users_online: number;
                credits: number;
                burned_credits: BigInt;
                burned_credits_total: BigInt;
                circulating_supply: number;
                total_rewards_shared: BigInt;
                total_revenue_shared: BigInt;
                canister_cycle_balance: BigInt;
                module_hash: string;
                domains: string[];
                bots: UserId[];
                weekly_karma_leaders: [UserId, number][];
                invited_users: number;
                posts: number;
                comments: number;
                bootcamp_users: number;
                state_size: number;
                account: string;
                last_weekly_chores: BigInt;
                e8s_for_one_xdr: BigInt;
                e8s_revenue_per_1k: BigInt;
                canister_id: string;
                team_tokens: { [name: UserId]: number };
                last_upgrade: number;
                buckets: [string, number][];
                stalwarts: UserId[];
            };
            config: {
                user_report_validity_days: number;
                downvote_counting_period_days: number;
                max_report_length: number;
                credits_per_xdr: number;
                max_funding_amount: number;
                min_stalwart_karma: number;
                min_credits_for_inviting: number;
                max_credits_mint_kilos: number;
                logo: string;
                poll_revote_deadline_hours: number;
                blob_cost: number;
                poll_cost: number;
                max_post_length: number;
                max_blob_size_bytes: number;
                name_change_cost: number;
                max_realm_name: number;
                max_realm_logo_len: number;
                post_cost: number;
                post_deletion_penalty_factor: number;
                token_symbol: string;
                transaction_fee: number;
                maximum_supply: number;
                proposal_approval_threshold: number;
                name: string;
                proposal_rejection_penalty: number;
                voting_power_activity_weeks: number;
                trusted_user_min_karma: number;
                trusted_user_min_age_weeks: number;
                min_stalwart_account_age_weeks: number;
                min_stalwart_activity_weeks: number;
                feed_page_size: number;
                reactions: [number, number][];
                token_decimals: number;
                domains: string[];
                reporting_penalty_post: number;
                reporting_penalty_misbehaviour: number;
            };
        };
    }
}
