import * as React from "react";
import { AuthClient } from "@dfinity/auth-client";
import { Ed25519KeyIdentity } from "@dfinity/identity";
import { createRoot } from "react-dom/client";
import { PostView } from "./post";
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
import { Proposals } from "./proposals";
import { Tokens, TransactionView, TransactionsView } from "./tokens";
import { Whitepaper } from "./whitepaper";
import { Recovery } from "./recovery";
import { MAINNET_MODE, TEST_MODE, CANISTER_ID } from "./env";
import { UserId } from "./types";
import { setRealmUI, setUI } from "./theme";
import { Close } from "./icons";
import { Search } from "./search";

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
        window.resetUI();
        window.realm = "";
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
        setRealmUI(param.toUpperCase());
    }

    if (handler == "settings") {
        content = auth(<Settings />);
    } else if (handler == "welcome") {
        subtle = !window.principalId;
        content = window.principalId ? (
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
        content = <PostView id={id} version={version} prime={true} />;
    } else if (handler == "edit") {
        const id = parseInt(param);
        content = auth(<PostSubmissionForm id={id} />);
    } else if (handler == "new") {
        subtle = true;
        content = auth(<PostSubmissionForm repost={parseInt(param2)} />);
    } else if (handler == "realms") {
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
        content = <TransactionView id={parseInt(param)} />;
    } else if (handler == "transactions") {
        content = <TransactionsView principal={param} prime={true} />;
    } else if (handler == "proposals") {
        content = <Proposals />;
    } else if (handler == "tokens") {
        content = <Tokens />;
    } else if (handler == "whitepaper" || handler == "about") {
        content = <Whitepaper />;
    } else if (handler == "dashboard" || handler == "stats") {
        content = <Dashboard />;
    } else if (handler == "search") {
        content = <Search initQuery={param} />;
    } else if (handler == "bookmarks") {
        content = auth(
            <PostFeed
                useList={true}
                title={<HeadBar title="BOOKMARKS" shareLink="bookmarks" />}
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
    } else {
        content = <Landing />;
    }

    headerRoot.render(
        <React.StrictMode>
            <Header
                subtle={subtle}
                inboxMode={inboxMode}
                route={window.location.hash}
            />
        </React.StrictMode>,
    );
    renderFrame(<React.StrictMode>{content}</React.StrictMode>);
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
        rewards: (users || []).reduce((acc, [id, _, karma]) => {
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
    window.resetUI = () => {
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
        window.authClient = authClient;
        let identity;
        if (await authClient.isAuthenticated()) {
            identity = authClient.getIdentity();
        } else if (localStorage.getItem("IDENTITY")) {
            const serializedIdentity = localStorage.getItem("IDENTITY");
            if (serializedIdentity) {
                identity = Ed25519KeyIdentity.fromJSON(serializedIdentity);
            }
        }
        const api = ApiGenerator(MAINNET_MODE, CANISTER_ID, identity);
        if (identity) window.principalId = identity.getPrincipal().toString();
        window.api = api;

        /*
         *  RECOVERY SHORTCUT
         */
        if (window.location.href.includes("recovery")) {
            document.getElementById("logo_container")?.remove();
            renderFrame(<React.StrictMode>{<Recovery />}</React.StrictMode>);
            window.user = await api.query<any>("user", []);
            return;
        }

        window.lastSavedUpgrade = 0;
        window.lastVisit = BigInt(0);
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
                <Footer />
            </React.StrictMode>,
        );
    },
);

const Footer = ({}) => {
    const [domainSelection, setDomainSelection] = React.useState(false);
    return (
        <footer className="small_text text_centered vertically_spaced">
            {domainSelection && (
                <>
                    <div className="bottom_spaced vertically_aligned">
                        ALTERNATIVE DOMAINS
                        <button
                            className="unselected left_half_spaced"
                            style={{
                                padding: 0,
                                position: "relative",
                                bottom: "0.1em",
                            }}
                            onClick={() => setDomainSelection(false)}
                        >
                            <Close classNameArg="accent clickable" size={12} />
                        </button>
                    </div>
                    <div className="column_container">
                        {window.backendCache.config.domains.map((domain) => (
                            <a
                                key={domain}
                                className="left_half_spaced right_half_spaced"
                                href={`https://${domain}`}
                            >
                                {domain}
                            </a>
                        ))}
                    </div>
                </>
            )}
            {!domainSelection && (
                <>
                    <a href="#/post/0">2021</a>
                    <span className="left_half_spaced right_half_spaced">
                        &middot;
                    </span>
                    <a href={location.origin}>{location.host.toLowerCase()}</a>
                    <span
                        className="accent clickable left_half_spaced"
                        onClick={() => setDomainSelection(true)}
                    >
                        &#9880;
                    </span>
                    <span className="left_half_spaced right_half_spaced">
                        &middot;
                    </span>
                    <a href="https://github.com/TaggrNetwork/taggr">GitHub</a>
                </>
            )}
        </footer>
    );
};

const updateDoc = () => {
    document.getElementById("logo_container")?.remove();
    const scroll_up_button = document.createElement("div");
    scroll_up_button.id = "scroll_up_button";
    scroll_up_button.innerHTML = "<span>&#9650;</span>";
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
    window.addEventListener("popstate", () => {
        let preview = document.getElementById("preview");
        if (preview) preview.style.display = "none";
        App();
    });
};
