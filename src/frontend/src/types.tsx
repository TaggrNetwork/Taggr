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
};

export type Report = {
    reason: string;
    reporter: UserId;
    confirmed_by: UserId[];
    rejected_by: UserId[];
};

declare global {
    interface Window {
        authClient: AuthClient;
        stackRoot: Root;
        cleanUICache: () => void;
        reloadUser: () => Promise<void>;
        reloadCache: () => Promise<void>;
        setUI: () => void;
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
            stats: { last_upgrade: number; buckets: [string, number][] };
            config: {
                reactions: [number, number][];
                token_decimals: number;
                domains: string[];
                reporting_penalty_post: number;
                reporting_penalty_misbehaviour: number;
            };
        };
    }
}
