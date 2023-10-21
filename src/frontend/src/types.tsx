import { Backend } from "./api";
import { Root } from "react-dom/client";
import { AuthClient } from "@dfinity/auth-client";

export type PostId = number;

export type UserId = number;

export type Extension =
    | {
          ["Poll"]: any;
      }
    | {
          ["Repost"]: any;
      }
    | {
          ["Proposal"]: any;
      };

export type Realm = {
    description: string;
    controllers: UserId[];
    theme: string;
    label_color: string;
    logo: string;
    num_posts: number;
    num_members: number;
};

export type Post = {
    id: PostId;
    parent?: PostId;
    watchers: UserId[];
    children: PostId[];
    user: UserId;
    userObject: { id: UserId; name: string; karma: number };
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
    author: UserId;
    created: BigInt;
};

export type Account = {
    owner: string;
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
};

export type User = {
    name: string;
    id: UserId;
    account: string;
    treasury_e8s: BigInt;
    principal: string;
    bookmarks: number[];
    last_activity: BigInt;
    settings: { theme: string };
    realms: string[];
    previous_names: string[];
    karma: number;
    report?: Report;
    stalwart: boolean;
    karma_from_last_posts: { [id: UserId]: number };
    followees: UserId[];
    followers: UserId[];
    feeds: string[][];
    accounting: [number, string, number, string][];
    timestamp: BigInt;
    active_weeks: number;
    invited_by?: UserId;
    about: string;
    rewarded_karma: number;
    cycles: number;
    num_posts: number;
    balance: number;
    controllers: string[];
    filters: Filters;
};

export type Report = {
    reason: string;
    reporter: UserId;
    confirmed_by: UserId[];
    rejected_by: UserId[];
    closed: boolean;
};

export type Theme = {
    text: string;
    background: string;
    code: string;
    clickable: string;
    accent: string;
};

export type Result = {
    Error: string;
    Ok: any;
};

declare global {
    interface Window {
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
            karma: { [name: UserId]: number };
            recent_tags: string[];
            realms: { [name: string]: [string, boolean] };
            stats: {
                holders: number;
                revenue_per_1k_e8s: BigInt;
                canister_id: string;
                team_tokens: { [name: UserId]: number };
                last_upgrade: number;
                buckets: [string, number][];
                stalwarts: UserId[];
            };
            config: {
                name_change_cost: number;
                realm_cleanup_penalty: number;
                max_realm_name: number;
                max_realm_logo_len: number;
                post_cost: number;
                post_deletion_penalty_factor: number;
                token_symbol: string;
                transaction_fee: number;
                total_supply: number;
                proposal_approval_threshold: number;
                name: string;
                proposal_rejection_penalty: number;
                revenue_share_activity_weeks: number;
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
