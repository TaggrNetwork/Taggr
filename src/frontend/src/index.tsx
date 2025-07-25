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
    loadFeed,
    expandMeta,
    showPopUp,
    domain,
    onCanonicalDomain,
    getCanonicalDomain,
} from "./common";
import { Settings } from "./settings";
import { Welcome } from "./welcome";
import { Proposals } from "./proposals";
import { Tokens, TransactionView, TransactionsView } from "./tokens";
import { Whitepaper } from "./whitepaper";
import { Recovery } from "./recovery";
import {
    Config,
    User,
    Stats,
    DomainConfig,
    getMonoRealm,
    getDefaultRealm,
    getJournal,
} from "./types";
import { setRealmUI, setUI } from "./theme";
import { Search } from "./search";
import { Distribution } from "./distribution";
import { populateUserNameCache } from "./user_resolve";
import { Roadmap } from "./roadmap";
import { LinksPage } from "./links";
import { ApiGenerator } from "./api";
import { MAINNET_MODE } from "./env";
import { Domains } from "./domains";
import {
    Delegate,
    DELEGATION_DOMAIN,
    DELEGATION_PRINCIPAL,
} from "./delegation";
import { LoginMasks } from "./authentication";

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
    document.getElementById("logo_container")?.remove();

    // This resets the stack.
    if (location.hash == "#/home") {
        window.resetUI();
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
    const auth = (content: React.ReactNode) =>
        window.principalId ? content : <Unauthorized />;
    let [handler = "", param, param2] = parseHash();

    let subtle = false;
    let inboxMode = false;
    let content = null;

    const journal = getJournal(window.backendCache.domains[domain()]);
    if (!handler && journal != null) {
        handler = "journal";
        param = journal.toString();
    }
    // If we're in a realm, but navigate outside of realm routes, reset the UI.
    else if (
        currentRealm() &&
        !window.hideRealmless &&
        ["#/realm/", "#/feed", "#/post/", "#/thread", "#/new"].every(
            (prefix: string) => !location.hash.startsWith(prefix),
        )
    ) {
        window.realm = "";
        window.uiInitialized = false;
    }

    setTitle(handler);
    if (window.monoRealm) setRealmUI(window.monoRealm);
    else if (window.defaultRealm && !currentRealm())
        setRealmUI(window.defaultRealm);
    else if (handler == "realm" && currentRealm() != param) {
        setRealmUI(param.toUpperCase());
    } else setUI();

    if (handler == "whitepaper") {
        content = <Whitepaper />;
    } else if (handler == "settings") {
        content = auth(<Settings />);
    } else if (handler == "sign-in") {
        subtle = true;
        content = <LoginMasks />;
    } else if (handler == "sign-up") {
        subtle = true;
        content = window.principalId ? (
            <Welcome />
        ) : (
            <LoginMasks signUp={true} />
        );
    } else if (handler == "welcome") {
        if (MAINNET_MODE && !onCanonicalDomain()) {
            location.href = `https://${getCanonicalDomain()}/#/welcome/${param}`;
            return;
        }
        subtle = true;
        content = window.principalId ? (
            <Settings invite={param} />
        ) : (
            <LoginMasks invite={true} signUp={true} />
        );
    } else if (handler == "post") {
        const id = parseInt(param);
        const version = parseInt(param2);
        subtle = true;
        content = <PostView id={id} version={version} prime={true} />;
    } else if (handler == "reposts") {
        const id = parseInt(param);
        content = (
            <PostFeed
                title={
                    <HeadBar
                        title={
                            <>
                                REPOSTS OF <a href={`#/post/${id}`}>#{id}</a>
                            </>
                        }
                        shareLink={`/reposts/${id}`}
                    />
                }
                feedLoader={async () => {
                    const posts = await loadFeed([id]);
                    if (posts && posts.length > 0)
                        return await loadFeed(expandMeta(posts[0]).reposts);
                    return [];
                }}
            />
        );
    } else if (handler == "edit") {
        const id = parseInt(param);
        content = auth(<PostSubmissionForm id={id} />);
    } else if (handler == "new") {
        subtle = true;
        const postId = parseInt(param2);
        content = auth(
            <PostSubmissionForm repost={isNaN(postId) ? undefined : postId} />,
        );
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
    } else if (handler == "delegate") {
        subtle = true;
        if (param) localStorage.setItem(DELEGATION_DOMAIN, param);
        if (param2) localStorage.setItem(DELEGATION_PRINCIPAL, param2);
        content = window.user ? <Delegate /> : <LoginMasks />;
    } else if (handler == "transaction") {
        content = <TransactionView id={parseInt(param)} />;
    } else if (handler == "transactions") {
        content = <TransactionsView icrcAccount={param} prime={true} />;
    } else if (handler == "proposals") {
        content = <Proposals />;
    } else if (handler == "tokens") {
        content = <Tokens />;
    } else if (handler == "dashboard" || handler == "stats") {
        content = <Dashboard />;
    } else if (handler == "search") {
        content = <Search initQuery={param} />;
    } else if (handler == "domains") {
        content = <Domains />;
    } else if (handler == "links") {
        content = <LinksPage />;
    } else if (handler == "distribution") {
        content = <Distribution />;
    } else if (handler == "roadmap") {
        content = <Roadmap />;
    } else if (handler == "bookmarks") {
        content = auth(
            <PostFeed
                useList={true}
                title={<HeadBar title="BOOKMARKS" shareLink="bookmarks" />}
                includeComments={true}
                feedLoader={async () => await loadFeed(window.user.bookmarks)}
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
    const [recent_tags, stats, config, domainsCfgResp] = await Promise.all([
        window.api.query<[string, any][]>("recent_tags", domain(), "", 500),
        window.api.query<Stats>("stats"),
        window.api.query<Config>("config"),
        window.api.query<any>("domains", domain()),
    ]);
    if (!config) console.error("Config wasn't loaded!");
    if (!stats) console.error("Stats weren't loaded!");
    window.backendCache = {
        recent_tags: recent_tags || [],
        stats: stats || ({} as Stats),
        config: config || ({} as Config),
        domains: domainsCfgResp || ({} as { [domain: string]: DomainConfig }),
    };
    const domainCfg =
        window.backendCache.domains[domain() || getCanonicalDomain()];
    window.monoRealm = getMonoRealm(domainCfg);
    window.defaultRealm = getDefaultRealm(domainCfg);
    window.hideRealmless = !!(
        window.monoRealm ||
        window.defaultRealm ||
        getJournal(domainCfg)
    );
    const last_upgrade = window.backendCache.stats?.last_release?.timestamp;
    if (!last_upgrade) return;
    else if (window.lastSavedUpgrade == 0) {
        window.lastSavedUpgrade = last_upgrade;
    } else if (window.lastSavedUpgrade != last_upgrade) {
        window.lastSavedUpgrade = last_upgrade;
        const banner = document.getElementById("upgrade_banner") as HTMLElement;
        banner.innerHTML = "New app version is available! Click me to reload.";
        banner.onclick = () => {
            banner.innerHTML = "RELOADING...";
            setTimeout(() => location.reload(), 100);
        };
        banner.style.display = "block";
    }
};

const confirmPrincipalChange = async () => {
    if (
        !window.principalId ||
        !(await window.api.query<boolean>("migration_pending"))
    )
        return;
    const response = await window.api.call<any>("confirm_principal_change");
    if (response && "Err" in response) {
        showPopUp("error", response.Err);
    }
};

const Footer = ({}) => (
    <footer className="small_text text_centered vertically_spaced">
        <>
            &#10045; <a href="#/post/0">2021</a>
            <span className="left_half_spaced right_half_spaced">&middot;</span>
            <a href={location.origin}>{location.host.toLowerCase()}</a>
        </>
    </footer>
);

const updateDoc = async () => {
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
            const visibleFrame = stack.lastElementChild;
            const pageFlipper = visibleFrame?.getElementsByClassName(
                "pageFlipper",
            )[0] as unknown as HTMLButtonElement;
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

export const instantiateApi = async () => {
    const authClient = await AuthClient.create({
        idleOptions: { disableIdle: true },
    });

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
    const api = ApiGenerator(MAINNET_MODE, identity);
    if (identity) window.principalId = identity.getPrincipal().toString();
    window.api = api;
    return identity;
};

const bootstrap = async () => {
    const identity = await instantiateApi();

    /*
     *  RECOVERY SHORTCUT
     */
    if (window.location.href.includes("recovery")) {
        createRoot(document.body as HTMLElement).render(
            <React.StrictMode>
                <Recovery />
            </React.StrictMode>,
        );
        window.user = await window.api.query<any>("user", "", []);
        return;
    }

    window.mainnet_api = ApiGenerator(true, identity);
    window.lastSavedUpgrade = 0;
    window.lastVisit = BigInt(0);
    window.reloadCache = reloadCache;
    window.setUI = setUI;
    window.resetUI = () => {
        window.uiInitialized = false;
        const frames = Array.from(stack.children);
        frames.forEach((frame) => frame.remove());
    };

    const futures = [reloadCache()];

    window.reloadUser = async () => {
        if (!window.api) return;

        const data = await window.api.query<User>("user", domain(), []);
        if (data) {
            let userIds = data.followees.concat(data.followers);
            populateUserNameCache(userIds);
            data.realms.reverse();
            window.user = data;
            if (600000 < microSecsSince(window.user.last_activity)) {
                window.lastVisit = window.user.last_activity;
                window.api.call("update_last_activity");
            } else if (window.lastVisit == BigInt(0))
                window.lastVisit = window.user.last_activity;
        }
    };

    setInterval(async () => {
        await window.reloadUser();
        await reloadCache();
    }, REFRESH_RATE_SECS * 1000);

    futures.push(confirmPrincipalChange().then(window.reloadUser));

    await Promise.all(futures);

    updateDoc();

    App();

    footerRoot.render(
        <React.StrictMode>
            <Footer />
        </React.StrictMode>,
    );
};

bootstrap();
