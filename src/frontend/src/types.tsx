import { Backend } from "./api";
import { Root } from "react-dom/client";
import { AuthClient } from "@dfinity/auth-client";

export type PostId = number;
export type UserId = number;
export type RealmId = string;

export type ICP = {
    e8s: BigInt | number;
};

export type DomainSubConfig =
    | {
          ["Journal"]: UserId;
      }
    | {
          ["BlackListedRealms"]: RealmId[];
      }
    | {
          ["WhiteListedRealms"]: RealmId[];
      };

export type DomainConfig = {
    owner: UserId;
    sub_config: DomainSubConfig;
    max_downvotes: number;
};

export const getMonoRealm = (cfg: DomainConfig) => {
    if (!("WhiteListedRealms" in cfg.sub_config)) return null;
    const whiteList = cfg.sub_config.WhiteListedRealms;
    return whiteList.length == 1 ? whiteList[0] : null;
};

export const getDefaultRealm = (cfg: DomainConfig) => {
    if (!("WhiteListedRealms" in cfg.sub_config)) return null;
    return cfg.sub_config.WhiteListedRealms[0];
};

export const getJournal = (cfg: DomainConfig) => {
    if (!("Journal" in cfg.sub_config)) return null;
    return cfg.sub_config.Journal;
};

export type PFP = {
    nonce: number;
    palette_nonce: number;
    colors: number;
    genesis: boolean;
};

export type Bid = {
    user: UserId;
    amount: number;
    e8s_per_token: number;
    timestamp: number;
};

export type Auction = {
    amount: number;
    bids: Bid[];
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

export type Mode = "Mining" | "Rewards" | "Credits";

export type Feature = {
    supporters: UserId[];
    status: number;
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
      }
    | "Feature";

export type Rewards = {
    receiver: string;
    minted: number;
};

export type Release = {
    commit: string;
    hash: string;
    binary: Uint8Array;
    closed_features: PostId[];
};

export type Icrc1Canister = {
    name: string;
    symbol: string;
    fee: number;
    decimals: number;
    logo?: string;
};

export type Payload =
    | { ["Noop"]: any }
    | {
          ["Release"]: Release;
      }
    | {
          ["Funding"]: [string, number];
      }
    | {
          ["ICPTransfer"]: [number[], ICP];
      }
    | {
          ["AddRealmController"]: [RealmId, UserId];
      }
    | {
          ["Rewards"]: Rewards;
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
    comments_filtering: boolean;
    adult_content: boolean;
    created: number;
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
    posts: PostId[];
    tokens?: string[];
};

export type Meta = {
    author_name: string;
    author_filters: UserFilter;
    viewer_blocked: boolean;
    realm_color: string;
    nsfw: boolean;
};

export type Post = {
    id: PostId;
    parent?: PostId;
    watchers: UserId[];
    children: PostId[];
    reposts: PostId[];
    user: UserId;
    body: string;
    effBody: string;
    reactions: { [id: number]: UserId[] };
    files: { [id: string]: [number, number] };
    patches: [BigInt, string][];
    tips: [UserId, BigInt][];
    hashes: string[];
    realm?: RealmId;
    timestamp: BigInt;
    extension: Extension;
    tree_size: number;
    tree_update: BigInt;
    meta: Meta;
    encrypted: boolean;
    external_tips?: PostTip[];
};

export type BlogTitle = {
    author: string;
    realm?: string;
    created: BigInt;
    length: number;
    background: string;
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
    pinned_posts: number[];
    last_activity: BigInt;
    governance: boolean;
    settings: {
        [key: string]: string;
    };
    realms: string[];
    previous_names: string[];
    report?: Report;
    post_reports: { [id: PostId]: bigint };
    stalwart: boolean;
    followees: UserId[];
    followers: UserId[];
    feeds: string[][];
    accounting: [number, string, number, string][];
    timestamp: bigint;
    active_weeks: number;
    invited_by?: UserId;
    controlled_realms: RealmId[];
    about: string;
    rewards: number;
    cycles: number;
    num_posts: number;
    balance: number;
    cold_balance: number;
    cold_wallet: string;
    controllers: string[];
    filters: Filters;
    blacklist: UserId[];
    notifications: { [key: number]: [Notification, boolean] };
    mode: Mode;
    pfp: PFP;
    deactivated: boolean;
    wallet_tokens: string[];
};

export type Report = {
    reason: string;
    reporter: UserId;
    confirmed_by: UserId[];
    rejected_by: UserId[];
    closed: boolean;
    timestamp: bigint;
};

export type LastReleaseInfo = {
    post_id: PostId;
    timestamp: number;
    commit: string;
};

export type Stats = {
    realms: number;
    bitcoin_treasury_sats: number;
    bitcoin_treasury_address: string;
    fees_burned: number;
    volume_day: number;
    volume_week: number;
    users: number;
    active_users: number;
    active_users_vp: number;
    users_online: number;
    credits: number;
    burned_credits: BigInt;
    circulating_supply: number;
    total_rewards_shared: BigInt;
    total_revenue_shared: BigInt;
    canister_cycle_balance: BigInt;
    last_release: LastReleaseInfo;
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
    vesting_tokens_of_x: [number, number];
    buckets: [string, number][];
    stalwarts: UserId[];
};

export type Config = {
    proposal_escrow_amount_xdr: number;
    staging: string;
    staging2: string;
    weekly_auction_size_tokens: number;
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
    feature_cost: number;
    blob_cost: number;
    poll_cost: number;
    max_post_length: number;
    max_blob_size_bytes: number;
    identity_change_cost: number;
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
    reporting_penalty_misbehaviour: number;
};

export type Theme = { [name: string]: any };
export type UserData = { [id: UserId]: string };

export interface PostTip {
    amount: number;
    canister_id: string;
    sender_id: number;
    index: number;
}

export interface IcExplorerUserTokenInfo {
    ledgerId: string;
    symbol: string;
    totalSupply: number;
    owner: string;
    subaccount: string;
    accountId: string;
    amount: number;
    tokenDecimal: number;
    snapshotTime: number;
    valueUSD: number;
}

export interface IcExplorerUserTokenResponse {
    list: IcExplorerUserTokenInfo[];
    pageNum: number;
    pageSize: number;
    size: number;
    startRow: number;
    endRow: number;
    pages: number;
    prePage: number;
    nextPage: number;
    isFirstPage: boolean;
    isLastPage: boolean;
    hasPreviousPage: boolean;
    hasNextPage: boolean;
    navigatePages: number;
    navigateFirstPage: number;
    navigateLastPage: number;
}

export interface TokenInfo {
    canisterId: string;
    symbol: string;
    subaccount: string;
    amount: number;
    decimals: number;
    usdAmount?: number;
    logo: string;
}

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
        // Domains with a single whitelisted realm
        monoRealm: string | null;
        // Domains with a whitelist, uses the first realm as default
        defaultRealm: string | null;
        hideRealmless: boolean;
        backendCache: {
            recent_tags: [string, number][];
            stats: Stats;
            config: Config;
            domains: { [domain: string]: DomainConfig };
        };
    }
}
