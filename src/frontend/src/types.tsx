import { Backend } from "./api";
import { Root } from "react-dom/client";
import { AuthClient } from "@dfinity/auth-client";

export type PostId = number;

export type UserId = number;

export type Post = {
    parent: PostId | null;
    user: UserId;
    userObject: { id: UserId; name: string; karma: number };
    report?: Report;
};

export type User = {
    name: string;
    id: UserId;
    bookmarks: number[];
    last_activity: BigInt;
    settings: { theme: string };
    realms: string[];
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
};

export type Report = {
    reason: string;
    reporter: UserId;
    confirmed_by: UserId[];
    rejected_by: UserId[];
    closed: boolean;
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
                last_upgrade: number;
                buckets: [string, number][];
                stalwarts: UserId[];
            };
            config: {
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
