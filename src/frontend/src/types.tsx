import { Backend } from "./api";
import { Root } from "react-dom/client";
import { AuthClient } from "@dfinity/auth-client";

export type PostId = number;

export type UserId = number;

export type User = {
    name: string;
    id: UserId;
    bookmarks: number[];
    last_activity: number;
    settings: { theme: string };
    realms: string[];
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
        lastVisit: number;
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
            stats: { last_upgrade: number };
            config: any;
        };
    }
}
