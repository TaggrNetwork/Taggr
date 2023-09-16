import * as React from "react";
import { AuthClient } from "@dfinity/auth-client";
import { Ed25519KeyIdentity } from "@dfinity/identity";
import { createRoot } from "react-dom/client";
import { Post } from "./post";
import { PostFeed } from "./post_feed";
import { Feed } from "./feed";
import { Thread } from "./thread";
import { Invites } from "./invites";
import { Inbox } from "./inbox";
import { Journal } from "./journal";
import { RealmForm, Realms } from "./realms";
import { Dashboard } from "./dashboard";
import { PostSubmissionForm } from "./new";
import { Profile } from "./profile";
import { Landing } from "./landing";
import { Header } from "./header";
import {
    Unauthorized,
    microSecsSince,
    HeadBar,
    setTitle,
    currentRealm,
} from "./common";
import { Settings } from "./settings";
import { ApiGenerator } from "./api";
import { Wallet, WelcomeInvited } from "./wallet";
import { applyTheme, getTheme } from "./theme";
import { Proposals } from "./proposals";
import { Tokens, Transaction } from "./tokens";
import { Whitepaper } from "./whitepaper";
import { Recovery } from "./recovery";
import { MAINNET_MODE, TEST_MODE, CANISTER_ID } from "./env";
import { Git, Rocket, Twitter } from "./icons";
import { UserId } from "./types";

const { hash, pathname } = location;

if (!hash && pathname != "/") {
    location.href = `#${pathname}`;
}

const REFRESH_RATE_SECS = 10 * 60;

const parseHash = (): string[] => {
    const parts = window.location.hash.replace("#", "").split("/");
    parts.shift();
    return parts.map(decodeURI);
};

const headerRoot = createRoot(document.getElementById("header") as Element);
const footerRoot = createRoot(document.getElementById("footer") as Element);
const stack = document.getElementById("stack") as HTMLElement;

const renderFrame = (content: React.ReactNode) => {
    // don't use the cache in testing mode
    if (TEST_MODE) {
        console.log("RUNNING IN TEST MODE!");
        if (!window.stackRoot) {
            window.stackRoot = createRoot(stack);
        }
        if (location.hash == "#/home") location.href = "#/";
        else window.stackRoot.render(content);
        return;
    }

    // This resets the stack.
    if (location.hash == "#/home") {
        window.cleanUICache();
        location.href = "#/";
        return;
    }

    const frames = Array.from(stack.children as HTMLCollectionOf<HTMLElement>);
    frames.forEach((e) => (e.style.display = "none"));
    const currentFrame = frames[frames.length - 1];
    const lastFrame = frames[frames.length - 2];

    if (lastFrame && lastFrame.dataset.hash == location.hash) {
        currentFrame.remove();
        lastFrame.style.display = "block";
        return;
    }

    let frame = document.createElement("div");
    frame.dataset.hash = location.hash;
    stack.appendChild(frame);
    createRoot(frame).render(content);
};

const App = () => {
    window.lastActivity = new Date();
    const api = window.api;
    const auth = (content: React.ReactNode) =>
        window.principalId ? content : <Unauthorized />;
    const [handler = "", param, param2] = parseHash();
    let subtle = false;
    let inboxMode = false;
    let content = null;

    setTitle(handler);
    setUI();
    if (handler == "realm" && currentRealm() != param) {
        window.realm = param;
        setRealmUI(param);
    }

    if (handler == "settings") {
        // @ts-ignore
        content = auth(<Settings />);
    } else if (handler == "whitepaper" || handler == "about") {
        content = <Whitepaper />;
    } else if (handler == "dashboard" || handler == "stats") {
        content = <Dashboard fullMode={true} />;
    } else if (handler == "welcome") {
        subtle = !window.principalId;
        content = window.principalId ? (
            // @ts-ignore
            <Settings invite={param} />
        ) : (
            <WelcomeInvited />
        );
    } else if (handler == "wallet" || (window.principalId && !window.user)) {
        content = <Wallet />;
    } else if (handler == "post") {
        const id = parseInt(param);
        const version = parseInt(param2);
        subtle = true;
        // @ts-ignore
        content = <Post id={id} version={version} prime={true} />;
    } else if (handler == "edit") {
        const id = parseInt(param);
        // @ts-ignore
        content = auth(<PostSubmissionForm id={id} />);
    } else if (handler == "new") {
        subtle = true;
        // @ts-ignore
        content = auth(<PostSubmissionForm repost={parseInt(param2)} />);
    } else if (handler == "realms") {
        // @ts-ignore
        if (param == "create") content = auth(<RealmForm />);
        else content = <Realms />;
    } else if (handler == "realm") {
        if (param) {
            if (param2 == "edit")
                content = auth(
                    <RealmForm existingName={param.toUpperCase()} />,
                );
            else content = <Landing />;
        } else content = <Realms />;
    } else if (handler == "inbox") {
        content = auth(<Inbox />);
        inboxMode = true;
    } else if (handler == "transaction") {
        content = <Transaction id={parseInt(param)} />;
    } else if (handler == "proposals") {
        content = <Proposals />;
    } else if (handler == "tokens") {
        content = <Tokens />;
    } else if (handler == "bookmarks") {
        content = auth(
            // @ts-ignore
            <PostFeed
                useList={true}
                // @ts-ignore
                title={<HeadBar title="Bookmarks" shareLink="bookmarks" />}
                includeComments={true}
                feedLoader={async () =>
                    await api.query("posts", window.user.bookmarks)
                }
            />,
        );
    } else if (handler == "invites") {
        content = auth(<Invites />);
    } else if (handler == "feed") {
        const params = param.split(/\+/).map(decodeURIComponent);
        content = <Feed params={params} />;
    } else if (handler == "thread") {
        content = <Thread id={parseInt(param)} />;
    } else if (handler == "user") {
        setTitle(`profile: @${param}`);
        content = <Profile handle={param} />;
    } else if (handler == "journal") {
        setTitle(`${param}'s journal`);
        subtle = true;
        content = <Journal handle={param} />;
    } else if (handler == "recovery") {
        content = <Recovery />;
    } else {
        content = <Landing />;
    }

    headerRoot.render(
        <React.StrictMode>
            <Header
                subtle={subtle}
                inboxMode={inboxMode}
                user={window.user}
                route={window.location.hash}
            />
        </React.StrictMode>,
    );
    renderFrame(<React.StrictMode>{content}</React.StrictMode>);
};

const setRealmUI = (realm: string) => {
    window.cleanUICache();
    window.api.query("realm", realm).then((result: any) => {
        let realmTheme = result.Ok?.theme;
        if (realmTheme) applyTheme(JSON.parse(realmTheme));
        else setUI();
    });
};

// If no realm is selected, set styling once.
const setUI = () => {
    if (currentRealm() || window.uiInitialized) return;
    applyTheme(getTheme(window.user?.settings.theme));
    window.uiInitialized = true;
};

const reloadCache = async () => {
    window.backendCache = window.backendCache || { users: [], recent_tags: [] };
    const [users, recent_tags, stats, config, realms] = await Promise.all([
        window.api.query<[UserId, string, number][]>("users"),
        window.api.query<[string, any][]>("recent_tags", "", 500),
        window.api.query<any>("stats"),
        window.api.query<any>("config"),
        window.api.query<[string, string, boolean][]>("realms_data"),
    ]);
    console.log("users", JSON.stringify(users).length / 1024);
    console.log("recent_tags", JSON.stringify(recent_tags).length / 1024);
    console.log("stats", JSON.stringify(stats).length / 1024);
    console.log("config", JSON.stringify(config).length / 1024);
    console.log("realms", JSON.stringify(realms).length / 1024);
    window.backendCache = {
        users: (users || []).reduce((acc, [id, name]) => {
            acc[id] = name;
            return acc;
        }, {} as any),
        karma: (users || []).reduce((acc, [id, _, karma]) => {
            acc[id] = karma;
            return acc;
        }, {} as any),
        recent_tags: (recent_tags || []).map(([tag, _]) => tag),
        realms: (realms || []).reduce((acc, [name, color, controller]) => {
            acc[name] = [color, controller];
            return acc;
        }, {} as any),
        stats,
        config,
    };
    window.cleanUICache = () => {
        if (TEST_MODE) return;
        const frames = Array.from(stack.children);
        frames.forEach((frame) => frame.remove());
        window.uiInitialized = false;
    };
    if (window.lastSavedUpgrade == 0) {
        window.lastSavedUpgrade = window.backendCache.stats.last_upgrade;
    } else if (
        window.lastSavedUpgrade != window.backendCache.stats.last_upgrade
    ) {
        window.lastSavedUpgrade = window.backendCache.stats.last_upgrade;
        const banner = document.getElementById("upgrade_banner") as HTMLElement;
        banner.innerHTML = "New app version is available! Click me to reload.";
        banner.onclick = () => {
            banner.innerHTML = "RELOADING...";
            setTimeout(() => location.reload(), 100);
        };
        banner.style.display = "block";
    }
};

AuthClient.create({ idleOptions: { disableIdle: true } }).then(
    async (authClient) => {
        window.lastSavedUpgrade = 0;
        window.authClient = authClient;
        let identity;
        if (await authClient.isAuthenticated()) {
            identity = authClient.getIdentity();
        } else if (localStorage.getItem("IDENTITY")) {
            const serializedIdentity = localStorage.getItem("IDENTITY");
            if (serializedIdentity) {
                identity = Ed25519KeyIdentity.fromJSON(serializedIdentity);
            }
        } else {
            const hash = localStorage.getItem("IDENTITY_DEPRECATED");
            if (hash) {
                identity = Ed25519KeyIdentity.generate(
                    new TextEncoder().encode(hash).slice(0, 32),
                );
            }
        }
        const api = ApiGenerator(MAINNET_MODE, CANISTER_ID, identity);
        if (identity) window.principalId = identity.getPrincipal().toString();
        window.lastVisit = BigInt(0);
        window.api = api;
        window.mainnet_api = ApiGenerator(true, CANISTER_ID, identity);
        window.reloadCache = reloadCache;
        window.setUI = setUI;
        await reloadCache();

        if (api) {
            window.reloadUser = async () => {
                let data = await api.query<any>("user", []);
                if (data) {
                    window.user = data;
                    window.user.realms.reverse();
                    window.user.settings = JSON.parse(data.settings || "{}");
                    if (600000 < microSecsSince(window.user.last_activity)) {
                        window.lastVisit = window.user.last_activity;
                        api.call("update_last_activity");
                    } else if (window.lastVisit == BigInt(0))
                        window.lastVisit = window.user.last_activity;
                }
            };
            setInterval(async () => {
                await window.reloadUser();
                await reloadCache();
            }, REFRESH_RATE_SECS * 1000);
            await window.reloadUser();
        }
        updateDoc();
        App();

        footerRoot.render(
            <React.StrictMode>
                <footer className="monospace small_text text_centered vertically_spaced">
                    <a href="#/whitepaper">
                        <Rocket classNameArg="action" />
                    </a>
                    &nbsp;&middot;&nbsp;
                    <a href="https://github.com/TaggrNetwork/taggr">
                        <Git classNameArg="action" />
                    </a>
                    &nbsp;&middot;&nbsp;
                    <a href="http://twitter.com/TaggrNetwork">
                        <Twitter classNameArg="action" />
                    </a>
                </footer>
            </React.StrictMode>,
        );
    },
);

const updateDoc = () => {
    const container = document.getElementById("logo_container");
    container?.remove();
    const scroll_up_button = document.createElement("div");
    scroll_up_button.id = "scroll_up_button";
    scroll_up_button.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" fill="currentColor" class="bi bi-arrow-up-circle-fill" viewBox="0 0 16 16"><path d="M16 8A8 8 0 1 0 0 8a8 8 0 0 0 16 0zm-7.5 3.5a.5.5 0 0 1-1 0V5.707L5.354 7.854a.5.5 0 1 1-.708-.708l3-3a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1-.708.708L8.5 5.707V11.5z"/></svg>`;
    document.body.appendChild(scroll_up_button);
    window.scrollUpButton = document.getElementById(
        "scroll_up_button",
    ) as HTMLElement;
    window.scrollUpButton.style.display = "none";
    window.scrollUpButton.onclick = () =>
        window.scrollTo({ top: 0, behavior: "smooth" });
    window.scrollUpButton.className = "clickable action";
    window.addEventListener("scroll", () => {
        window.lastActivity = new Date();
        window.scrollUpButton.style.display =
            window.scrollY > 1500 ? "flex" : "none";
        const h = document.documentElement,
            b = document.body,
            st = "scrollTop",
            sh = "scrollHeight";

        const percent =
            ((h[st] || b[st]) / ((h[sh] || b[sh]) - h.clientHeight)) * 100;
        if (percent > 60) {
            const pageFlipper = document.getElementById("pageFlipper");
            if (pageFlipper) pageFlipper.click();
        }
    });
    window.addEventListener("keyup", () => {
        window.lastActivity = new Date();
        window.scrollUpButton.style.display = "none";
    });
    window.addEventListener("popstate", App);
};
