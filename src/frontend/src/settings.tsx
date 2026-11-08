import * as React from "react";
import {
    hash,
    ButtonWithLoading,
    confirmPopUp,
    errorText,
    HeadBar,
    ICP_LEDGER_ID,
    hex,
    handleError,
    showPopUp,
    signOutAndRestart,
    sizeMb,
    showCycles,
    onCanonicalDomain,
    UnavailableOnCustomDomains,
    tagList,
    RealmList,
    TabBar,
} from "./common";
import { CanisterStatus, User, UserFilter } from "./types";
import { Principal } from "@icp-sdk/core/principal";
import { setTheme } from "./theme";
import { UserList } from "./user_resolve";
import { UserLinks, linksError, parseLinks } from "./profile";
import { Box, Credits, Fire, StorageCanister, HourGlass } from "./icons";
import {
    BLACKHOLE_PRINCIPAL,
    fetchCanisterStatus,
    daysToLive,
    openStorageCreation,
    topUpCanister,
    upgradeBucket,
} from "./user_storage";

export const DEFAULT_REACTION_HOLD_TIME = 350;

const StorageSection = ({ user }: { user: User }) => {
    const [bucket, setBucket] = React.useState<typeof user.bucket>(user.bucket);
    const [status, setStatus] = React.useState<CanisterStatus | null>(null);
    const [statusError, setStatusError] = React.useState<string | null>(null);
    const [topUp, setTopUp] = React.useState("");
    const [expectedHash, setExpectedHash] = React.useState<string | null>(null);

    React.useEffect(() => {
        window.api
            .query<string>("bucket_wasm_hash")
            .then(setExpectedHash)
            .catch(() => {});
    }, []);

    const loadStatus = React.useCallback(() => {
        if (!bucket) return;
        setStatus(null);
        setStatusError(null);
        fetchCanisterStatus(Principal.fromText(bucket))
            .then(setStatus)
            .catch((err) => setStatusError(errorText(err)));
    }, [bucket]);

    React.useEffect(() => {
        loadStatus();
    }, [loadStatus]);

    const onCreate = async () => {
        const id = await openStorageCreation();
        if (id) {
            await window.reloadUser();
            setBucket(window.user?.bucket);
        }
    };

    const addBlackhole = async () => {
        if (!bucket || !status) return;
        try {
            await window.api.add_bucket_controller(
                Principal.fromText(bucket),
                status.controllers,
                BLACKHOLE_PRINCIPAL,
            );
            showPopUp("success", "Blackhole canister added as controller.", 5);
            loadStatus();
        } catch (err) {
            showPopUp("error", errorText(err), 7);
        }
    };

    const onTopUp = async () => {
        if (!bucket) return;
        const icp = parseFloat(topUp);
        if (!isFinite(icp) || icp <= 0) {
            showPopUp("error", "Enter a valid ICP amount.", 5);
            return;
        }
        const ok = await confirmPopUp(
            `Transfer ${icp} ICP from your wallet to top up your storage canister with cycles?`,
            { confirmLabel: "Top up", cancelLabel: "Cancel" },
        );
        if (!ok) return;
        try {
            const cycles = await topUpCanister(
                Principal.fromText(bucket),
                Math.round(icp * 1e8),
            );
            showPopUp(
                "success",
                `Canister topped up with ${(
                    Number(cycles) /
                    10 ** 12
                ).toLocaleString()}T cycles.`,
                5,
            );
            setTopUp("");
            loadStatus();
        } catch (err) {
            showPopUp("error", errorText(err), 7);
        }
    };

    const onUpgrade = async () => {
        if (!bucket) return;
        const ok = await confirmPopUp(
            "Upgrade your storage canister to the latest version? Your stored images are preserved.",
            { confirmLabel: "Upgrade", cancelLabel: "Cancel" },
        );
        if (!ok) return;
        try {
            await upgradeBucket(Principal.fromText(bucket));
            showPopUp("success", "Storage canister upgraded.", 5);
            loadStatus();
        } catch (err) {
            showPopUp("error", errorText(err), 7);
        }
    };

    const deployedHash = status?.module_hash ? hex(status.module_hash) : null;
    const upgradeAvailable =
        !!expectedHash && !!deployedHash && expectedHash !== deployedHash;

    const dashboard = bucket && (
        <div className="vertically_spaced">
            <h2>
                <StorageCanister classNameArg="right_half_spaced" />
                <a
                    target="_blank"
                    href={`https://dashboard.internetcomputer.org/canister/${bucket}`}
                >
                    Your storage canister
                </a>
            </h2>
            {upgradeAvailable &&
                (onCanonicalDomain() ? (
                    <div className="banner vertically_spaced column_container">
                        A storage canister update is available.
                        <ButtonWithLoading
                            classNameArg="top_spaced"
                            onClick={onUpgrade}
                            label="Upgrade storage"
                        />
                    </div>
                ) : (
                    <p className="banner vertically_spaced">
                        A storage canister update is available. Switch to the
                        canonical domain to upgrade.
                    </p>
                ))}
            <div className="dynamic_table">
                <div className="db_cell">
                    <label>
                        <Box /> STATE
                    </label>
                    {status ? sizeMb(status.memory_size) : <code>…</code>}
                </div>
                <div className="db_cell">
                    <label>
                        <Credits /> CYCLES
                    </label>
                    {status ? showCycles(status.cycles) : <code>…</code>}
                </div>
                <div className="db_cell">
                    <label>
                        <Fire /> DAILY BURN
                    </label>
                    {status ? (
                        showCycles(status.idle_cycles_burned_per_day)
                    ) : (
                        <code>…</code>
                    )}
                </div>
                <div className="db_cell">
                    <label>
                        <HourGlass /> DAYS TO LIVE
                    </label>
                    {status ? (
                        daysToLive(
                            status.cycles,
                            status.idle_cycles_burned_per_day,
                        )
                    ) : (
                        <code>…</code>
                    )}
                </div>
            </div>
            {status && (
                <div className="top_spaced column_container">
                    <div className="bottom_half_spaced">Controllers</div>
                    {status.controllers.map((p) => (
                        <code
                            key={p.toText()}
                            className="selectable top_half_spaced breakable"
                        >
                            {p.toText()}
                        </code>
                    ))}
                    {!status.controllers.some(
                        (p) => p.toText() === BLACKHOLE_PRINCIPAL.toText(),
                    ) && (
                        <ButtonWithLoading
                            classNameArg="active top_spaced"
                            onClick={addBlackhole}
                            label="Add blackhole controller"
                        />
                    )}
                </div>
            )}
            <div className="top_spaced column_container">
                <label className="bottom_half_spaced" htmlFor="storage-top-up">
                    Top up with cycles
                </label>
                <div className="row_container">
                    <input
                        id="storage-top-up"
                        type="number"
                        min="0"
                        step="0.0001"
                        placeholder="ICP amount"
                        value={topUp}
                        className="max_width_col right_half_spaced"
                        onChange={(e) => setTopUp(e.target.value)}
                    />
                    <ButtonWithLoading
                        classNameArg="active"
                        onClick={onTopUp}
                        label="Top up"
                    />
                </div>
            </div>
            {statusError && (
                <p className="small_text top_spaced banner">
                    Failed to fetch canister status: {statusError}
                </p>
            )}
        </div>
    );

    return (
        <>
            {dashboard}
            {bucket ? null : onCanonicalDomain() ? (
                <>
                    <div className="bottom_spaced">
                        Create a personal storage canister to attach images to
                        your posts.
                    </div>
                    <ButtonWithLoading
                        classNameArg="active max_width_col"
                        onClick={onCreate}
                        label="Create storage"
                    />
                </>
            ) : (
                <UnavailableOnCustomDomains component="Storage creation" />
            )}
        </>
    );
};

const TABS = [
    "Profile",
    "Appearance",
    "Privacy",
    "Storage",
    "Advanced",
] as const;
type Tab = (typeof TABS)[number];

// Compare settings objects by sorted keys so backend key order can't make a
// saved form look dirty.
const stableKey = (value: any) =>
    JSON.stringify(
        Object.keys(value || {})
            .sort()
            .map((key) => [key, value[key]]),
    );

export const Settings = ({
    invite,
    tab: initialTabProp,
}: {
    invite?: string;
    tab?: string;
}) => {
    const user = window.user;
    const [principal, setPrincipal] = React.useState(window.principalId);
    const [principalChangeRequested, setPrincipalChangeRequested] =
        React.useState<string | null>(null);
    const principalChangeSubmitted = React.useRef(false);
    // Rehydrate a pending principal change on mount so a reload doesn't lose
    // the "request registered" state. Ignore a late reply once the user has
    // submitted a request here, so it can't wipe the fresh value.
    React.useEffect(() => {
        window.api
            .query<string | null>("principal_change_target")
            .then((target) => {
                if (!principalChangeSubmitted.current)
                    setPrincipalChangeRequested(target || null);
            });
    }, []);
    const [name, setName] = React.useState(user?.name || "");
    const [about, setAbout] = React.useState(user?.about || "");
    const [settings, setSettings] = React.useState<{ [name: string]: string }>(
        user?.settings || {},
    );
    const [encKey, setEncKey] = React.useState("");
    const [label, setLabel] = React.useState(null);
    const [timer, setTimer] = React.useState<any>();
    const [uiRefresh, setUIRefresh] = React.useState(false);
    const [settingsError, setSettingsError] = React.useState("");
    const [governance, setGovernance] = React.useState(
        user?.governance.toString() || "true",
    );
    const [mode, setMode] = React.useState<string>(user?.mode || "Mining");
    const [showPostsInRealms, setShowPostsInRealms] = React.useState(
        user?.show_posts_in_realms.toString() || "true",
    );
    const [userFilter, setUserFilter] = React.useState<UserFilter>(
        user?.filters.noise || {
            safe: false,
            age_days: 0,
            balance: 0,
            num_followers: 0,
        },
    );
    // Route params keep their historical casing (e.g. #/settings/STORAGE).
    const initialTab = TABS.find(
        (t) => t.toUpperCase() === (initialTabProp || "").toUpperCase(),
    );
    const [tab, setTab] = React.useState<Tab>(initialTab || "Profile");
    const links = parseLinks(settings);

    const snapshot = (u: User | undefined) => ({
        name: u?.name || "",
        about: u?.about || "",
        governance: u?.governance.toString() || "true",
        mode: u?.mode || "Mining",
        showPostsInRealms: u?.show_posts_in_realms.toString() || "true",
        settings: stableKey(u?.settings),
        noise: stableKey(u?.filters.noise),
    });
    const [saved, setSaved] = React.useState(() => snapshot(user));
    const dirty =
        !!user &&
        (name !== saved.name ||
            about !== saved.about ||
            governance !== saved.governance ||
            mode !== saved.mode ||
            showPostsInRealms !== saved.showPostsInRealms ||
            stableKey(settings) !== saved.settings ||
            stableKey(userFilter) !== saved.noise);

    const updateData = (user: User) => {
        if (!user) return;
        setName(user.name);
        setAbout(user.about);
        setSettings(user.settings);
        setGovernance(user.governance.toString());
        setMode(user.mode);
        setShowPostsInRealms(user.show_posts_in_realms.toString());
        setUserFilter(user.filters.noise);
        setSaved(snapshot(user));
    };

    React.useEffect(() => updateData(user), []);

    const setSetting = (key: string, e: any) => {
        const newSettings: { [name: string]: string } = {};
        Object.keys(settings).forEach((k) => (newSettings[k] = settings[k]));
        const value = e.target.value;
        // An empty or non-positive delay parses to 0 downstream, where it makes
        // reactions fire on touch. Drop the key instead so the default applies
        // and the field cannot be left blank.
        delete newSettings[key];
        if (key != "tap_and_hold" || Number(value) > 0)
            newSettings[key] = value;
        setSettings(newSettings);
        if (["theme", "columns"].includes(key)) setUIRefresh(true);
        return newSettings[key];
    };

    const namePicker = (event: any) => {
        clearTimeout(timer);
        const name = event.target.value;
        if (name)
            setTimer(
                setTimeout(
                    () =>
                        window.api
                            .query<any>("validate_username", name)
                            .then((result) => {
                                if (result)
                                    setLabel(
                                        "Err" in result
                                            ? result.Err
                                            : "available!",
                                    );
                            }),
                    300,
                ),
            );
        setName(name);
    };

    const submit = async () => {
        setSettingsError("");
        const registrationFlow = !user;
        let registrationRealmId: string | undefined;
        if (registrationFlow) {
            let response = await window.api.call<any>(
                "create_user",
                name,
                invite || "",
            );
            if (handleError(response, undefined, setSettingsError)) return;
            registrationRealmId = response?.Ok;
        }

        const nameChange = !registrationFlow && user.name != name;
        if (nameChange) {
            if (
                !(await confirmPopUp(
                    `A name change incurs costs of ${window.backendCache.config.identity_change_cost} credits. ` +
                        `Moreover, the old name will still route to your profile. ` +
                        `Do you want to continue?`,
                ))
            )
                return;
        }

        const responses = await Promise.all([
            window.api.call<any>(
                "update_user",
                nameChange ? name : "",
                about,
                userFilter,
                governance == "true",
                // For new and invited users, set the mode to "Credits"
                registrationFlow && invite ? "Credits" : mode,
                showPostsInRealms == "true",
            ),
            window.api.call<any>("update_user_settings", settings),
        ]);
        for (let i in responses) {
            const response = responses[i];
            if (handleError(response, undefined, setSettingsError)) return;
        }
        if (registrationFlow) {
            await window.reloadUser();
            location.href = registrationRealmId
                ? `/#/realm/${registrationRealmId}`
                : "/";
        } else if (nameChange) location.href = "/";
        else if (uiRefresh) {
            await window.reloadUser();
            window.uiInitialized = false;
            window.setUI();
            updateData(window.user);
        }
        await window.reloadUser();
        setSaved(snapshot(window.user));
    };

    const profileSection = (
        <>
            <label className="bottom_half_spaced" htmlFor="settings-name">
                User name <span className="accent">[required]</span>
                <code className="left_half_spaced">{label}</code>
            </label>
            <input
                id="settings-name"
                type="text"
                value={name}
                className="bottom_spaced"
                placeholder="alphanumeric"
                onChange={namePicker}
            />
            <label className="bottom_half_spaced" htmlFor="settings-about">
                About you
            </label>
            <input
                id="settings-about"
                placeholder="tell us what we should know about you"
                className="bottom_spaced"
                type="text"
                value={about}
                onChange={(event) => setAbout(event.target.value)}
            />
            {user && (
                <>
                    <label
                        className="bottom_half_spaced"
                        htmlFor="settings-mode"
                    >
                        Usage mode
                    </label>
                    <select
                        id="settings-mode"
                        data-testid="mode-selector"
                        value={mode}
                        className="bottom_spaced"
                        onChange={(event) => setMode(event.target.value)}
                    >
                        <option value="Credits">
                            Convert rewards to credits automatically
                        </option>
                        <option value="Rewards">Receive ICP rewards</option>
                        <option value="Mining">
                            Mine {window.backendCache.config.token_symbol}{" "}
                            tokens
                        </option>
                    </select>
                    <div className="bottom_half_spaced">
                        Participate in governance
                    </div>
                    <select
                        aria-label="Participate in governance"
                        value={governance}
                        className="bottom_spaced"
                        onChange={(event) => setGovernance(event.target.value)}
                    >
                        <option value="true">Yes</option>
                        <option value="false">No</option>
                    </select>
                    <label
                        className="bottom_half_spaced"
                        htmlFor="settings-links"
                    >
                        Your links (one per line)
                    </label>
                    <textarea
                        id="settings-links"
                        placeholder="Twitter: https://twitter.com/user_name"
                        className="bottom_half_spaced"
                        rows={4}
                        value={settings.links || ""}
                        onChange={(event) => setSetting("links", event)}
                    ></textarea>
                    <div className="bottom_spaced">
                        {links.length > 0 &&
                            (linksError(settings.links) ? (
                                <span className="error">
                                    {linksError(settings.links)}
                                </span>
                            ) : (
                                <UserLinks links={links} prefix="Links:" />
                            ))}
                    </div>
                    <label
                        className="bottom_half_spaced"
                        htmlFor="settings-pgp"
                    >
                        PGP public key
                    </label>
                    <textarea
                        id="settings-pgp"
                        placeholder="-----BEGIN PGP PUBLIC KEY BLOCK-----"
                        className="bottom_spaced"
                        rows={6}
                        value={settings.pgp || ""}
                        onChange={(event) => setSetting("pgp", event)}
                    ></textarea>
                    <div className="bottom_half_spaced">
                        Enable ICRC tokens in the wallet
                    </div>
                    <select
                        data-testid="ic-wallet-select"
                        aria-label="Enable ICRC tokens in the wallet"
                        value={settings.icrcWallet || "false"}
                        className="bottom_spaced"
                        onChange={(event) => setSetting("icrcWallet", event)}
                    >
                        <option value="true">Yes</option>
                        <option value="false">No</option>
                    </select>
                </>
            )}
        </>
    );

    const appearanceSection = (
        <>
            <label className="bottom_half_spaced" htmlFor="settings-theme">
                Colour scheme
            </label>
            <select
                id="settings-theme"
                value={settings.theme}
                className="bottom_spaced"
                onChange={(event) => {
                    const name = setSetting("theme", event);
                    setTheme(name);
                }}
            >
                <option value="dark">Dark</option>
                <option value="calm">Calm</option>
                <option value="midnight">Midnight</option>
                <option value="classic">Classic</option>
                <option value="black">Black</option>
                <option value="light">Light</option>
            </select>
            <div className="bottom_half_spaced">
                Override realm colour themes
            </div>
            <select
                aria-label="Override realm colour themes"
                value={settings.overrideRealmColors || "false"}
                className="bottom_spaced"
                onChange={(event) => setSetting("overrideRealmColors", event)}
            >
                <option value="true">Yes</option>
                <option value="false">No</option>
            </select>
            <div className="bottom_half_spaced">
                Multi-column layout on landing page
            </div>
            <select
                aria-label="Multi-column layout on landing page"
                value={settings.columns || "on"}
                className="bottom_spaced"
                onChange={(event) => setSetting("columns", event)}
            >
                <option value="on">On</option>
                <option value="off">Off</option>
            </select>
            <label
                className="bottom_half_spaced"
                htmlFor="settings-tap-and-hold"
            >
                Reaction tap-and-hold delay (smaller is faster)
            </label>
            <input
                id="settings-tap-and-hold"
                className="bottom_spaced"
                type="number"
                min="0"
                step="any"
                value={
                    "tap_and_hold" in settings
                        ? settings.tap_and_hold
                        : DEFAULT_REACTION_HOLD_TIME
                }
                onChange={(event) => setSetting("tap_and_hold", event)}
            />
        </>
    );

    const privacySection = (
        <>
            <h2>Noise filter</h2>
            <div className="stands_out">
                <p>The noise filters define:</p>
                <ul>
                    <li>
                        actions of which users can trigger a notification in
                        your inbox,
                    </li>
                    <li>
                        posts of which users will appear in all tabs on your
                        landing page.
                    </li>
                </ul>
            </div>
            <br />
            <div className="column_container bottom_spaced">
                <div className="vcentered">
                    <input
                        type="checkbox"
                        checked={userFilter.safe}
                        onChange={() => {
                            userFilter.safe = !userFilter.safe;
                            setUserFilter({ ...userFilter });
                        }}
                        id="filter_safe"
                    />
                    <label className="left_half_spaced" htmlFor="filter_safe">
                        Non-controversial users (without confirmed reports)
                    </label>
                </div>
            </div>
            <div className="column_container bottom_spaced">
                <label className="bottom_half_spaced" htmlFor="filter_balance">
                    Minimal {window.backendCache.config.token_symbol} balance:
                </label>
                <input
                    type="number"
                    min="0"
                    value={userFilter.balance}
                    onChange={(e) => {
                        userFilter.balance = Number(e.target.value);
                        setUserFilter({ ...userFilter });
                    }}
                    id="filter_balance"
                />
            </div>
            <div className="column_container bottom_spaced">
                <label className="bottom_half_spaced" htmlFor="filter_age_days">
                    Minimal account age (days):
                </label>
                <input
                    type="number"
                    min="0"
                    value={userFilter.age_days}
                    onChange={(e) => {
                        userFilter.age_days = Number(e.target.value);
                        setUserFilter({ ...userFilter });
                    }}
                    id="filter_age_days"
                />
            </div>
            <div className="column_container bottom_spaced">
                <label
                    className="bottom_half_spaced"
                    htmlFor="filter_num_followers"
                >
                    Minimal number of followers:
                </label>
                <input
                    type="number"
                    min="0"
                    value={userFilter.num_followers}
                    onChange={(e) => {
                        userFilter.num_followers = Number(e.target.value);
                        setUserFilter({ ...userFilter });
                    }}
                    id="filter_num_followers"
                />
            </div>
            <div className="bottom_half_spaced">
                Show posts from followed people posted in realms you are not a
                member of:
            </div>
            <select
                aria-label="Show posts from followed people posted in realms you are not a member of"
                value={showPostsInRealms}
                className="bottom_spaced"
                onChange={(event) => setShowPostsInRealms(event.target.value)}
            >
                <option value="true">Yes</option>
                <option value="false">No</option>
            </select>
            {user && user.filters.users.length > 0 && (
                <>
                    <h2>Muted users</h2>
                    <div>
                        <UserList profile={true} ids={user.filters.users} />
                    </div>
                </>
            )}
            {user && user.blacklist.length > 0 && (
                <>
                    <h2>Blocked users</h2>
                    <div>
                        <UserList profile={true} ids={user.blacklist} />
                    </div>
                </>
            )}
            {user && user.filters.tags.length > 0 && (
                <>
                    <h2>Muted tags</h2>
                    <div>{tagList(user.filters.tags.map((tag) => [tag]))}</div>
                </>
            )}
            {user && user.filters.realms.length > 0 && (
                <>
                    <h2>Muted realms</h2>
                    <div>
                        <RealmList ids={user.filters.realms} />
                    </div>
                </>
            )}
        </>
    );

    const storageSection = user && <StorageSection user={user} />;

    const advancedSection = user && (
        <>
            <h2>Account suspension</h2>
            <p>
                You can suspend your account and encrypt all your messages to
                make them inaccessible. If you ever plan to activate your
                account again, make sure you can recover this password later. An
                account activation/deactivation costs{" "}
                {window.backendCache.config.account_activation_cost} credits.
            </p>
            {onCanonicalDomain() ? (
                <>
                    <label
                        className="bottom_half_spaced"
                        htmlFor="settings-enc-key"
                    >
                        Encryption password
                    </label>
                    <input
                        id="settings-enc-key"
                        placeholder="Encryption password"
                        className="bottom_spaced"
                        type="password"
                        value={encKey}
                        onChange={(event) => setEncKey(event.target.value)}
                    />
                    <ButtonWithLoading
                        classNameArg={encKey ? "" : "inactive"}
                        onClick={async () => {
                            if (!encKey) return;
                            const seed = hex(Array.from(await hash(encKey, 1)));
                            const result: any = await window.api.call(
                                "crypt",
                                seed,
                            );
                            const prefix = user.deactivated ? "de" : "en";
                            if (result && "Ok" in result) {
                                showPopUp(
                                    "success",
                                    `${result.Ok} posts successfully ${prefix}crypted!`,
                                    5,
                                );
                            } else {
                                showPopUp(
                                    "error",
                                    `${prefix}cryption failed (${result?.Err || "wrong password?"})`,
                                    5,
                                );
                            }
                        }}
                        label={user.deactivated ? "Activate" : "Deactivate"}
                    />
                </>
            ) : (
                <UnavailableOnCustomDomains />
            )}
            <hr />
            <h2>Principal change</h2>
            You can change your principal as follows:
            <ol>
                <li>
                    Log in using the new authentication method (a new II anchor
                    or a seed phrase). Use <b>Sign-up</b>, not Sign-in.
                </li>
                <li>
                    On the "New user detected" page, copy the principal shown
                    next to "Your {window.backendCache.config.name} principal"
                    and log out again <b>without creating a new user</b>.
                </li>
                <li>
                    Login back to your account using the old authentication
                    method and paste the new principal in the text field below.
                </li>
                <li>Change the principal.</li>
                <li>
                    Sign out, then log in with the new authentication method.
                    The change is confirmed automatically on login.
                </li>
            </ol>
            {onCanonicalDomain() ? (
                principalChangeRequested ? (
                    <>
                        <p className="bottom_spaced">
                            <b>Request registered.</b> The principal{" "}
                            <code>{principalChangeRequested}</code> is now
                            waiting to replace your current one.
                        </p>
                        <p className="bottom_spaced">
                            To finish, sign out and log in again using the new
                            authentication method. The change is confirmed
                            automatically on login.
                        </p>
                        <ButtonWithLoading
                            classNameArg="active"
                            onClick={async () => {
                                location.hash = "#/sign-in";
                                await signOutAndRestart();
                            }}
                            label="Sign out and sign in with new principal"
                        />
                    </>
                ) : (
                    <>
                        <label
                            className="bottom_half_spaced"
                            htmlFor="settings-principal"
                        >
                            New principal
                        </label>
                        <input
                            id="settings-principal"
                            placeholder="Your principal"
                            className="bottom_spaced"
                            type="text"
                            value={principal}
                            onChange={(event) =>
                                setPrincipal(event.target.value)
                            }
                        />
                        <ButtonWithLoading
                            classNameArg={
                                principal != window.principalId
                                    ? ""
                                    : "inactive"
                            }
                            onClick={async () => {
                                const accountBalance =
                                    await window.api.account_balance(
                                        ICP_LEDGER_ID,
                                        {
                                            owner: Principal.fromText(
                                                user.principal,
                                            ),
                                        },
                                    );
                                if (accountBalance > 0) {
                                    showPopUp(
                                        "warning",
                                        "Your ICP balance is not empty. Please withdraw all funds before changing the principal.",
                                        5,
                                    );
                                    return;
                                }
                                const newPrincipalText = principal.trim();
                                let newPrincipal: Principal;
                                try {
                                    newPrincipal =
                                        Principal.fromText(newPrincipalText);
                                } catch (err) {
                                    return showPopUp(
                                        "error",
                                        `Invalid principal: ${err}`,
                                    );
                                }
                                if (user.bucket) {
                                    const addController = await confirmPopUp(
                                        `You own a storage canister. The new principal must be added as a controller of that canister now, while the old principal is still authenticated; otherwise you would lose ALL control of the canister after the principal change (cannot upload, free, upgrade, or delete it). Removing the OLD principal from the canister's controller list afterward is YOUR responsibility — ${window.backendCache.config.name} will not do it.`,
                                        {
                                            confirmLabel: "Add controller",
                                            cancelLabel: "Abort",
                                        },
                                    );
                                    if (!addController) {
                                        return;
                                    }
                                    try {
                                        // Preserve the canister's current on-chain
                                        // controllers (e.g. blackhole) instead of
                                        // resetting to [old, new], which would
                                        // silently strip them.
                                        const { controllers } =
                                            await fetchCanisterStatus(
                                                Principal.fromText(user.bucket),
                                            );
                                        await window.api.add_bucket_controller(
                                            Principal.fromText(user.bucket),
                                            controllers,
                                            newPrincipal,
                                        );
                                        showPopUp(
                                            "success",
                                            "The new principal was added as a controller of your storage canister.",
                                            5,
                                        );
                                    } catch (err) {
                                        return showPopUp(
                                            "error",
                                            `Failed to add controller — principal change aborted: ${err}`,
                                            7,
                                        );
                                    }
                                }
                                let response = await window.api.call<any>(
                                    "request_principal_change",
                                    newPrincipalText,
                                );
                                if (
                                    handleError(
                                        response,
                                        undefined,
                                        setSettingsError,
                                    )
                                )
                                    return;
                                principalChangeSubmitted.current = true;
                                setPrincipalChangeRequested(newPrincipalText);
                            }}
                            label="Change principal"
                        />
                    </>
                )
            ) : (
                <UnavailableOnCustomDomains />
            )}
        </>
    );

    // Registration flow: no tabs, just the profile fields and a save button.
    if (!user) {
        return (
            <>
                <HeadBar title="Settings" shareLink="settings" />
                <div className="spaced column_container">
                    {settingsError && (
                        <div className="error bottom_spaced" role="alert">
                            {settingsError}
                        </div>
                    )}
                    {profileSection}
                    <ButtonWithLoading
                        classNameArg="active top_spaced"
                        onClick={submit}
                        label="Save"
                    />
                </div>
            </>
        );
    }

    return (
        <>
            <HeadBar title="Settings" shareLink="settings" />
            <div className="spaced column_container">
                {settingsError && (
                    <div className="error bottom_spaced" role="alert">
                        {settingsError}
                    </div>
                )}
                <TabBar
                    tabs={[...TABS]}
                    activeTab={tab}
                    onTabChange={(t) => setTab(t as Tab)}
                />
                {tab === "Profile" && profileSection}
                {tab === "Appearance" && appearanceSection}
                {tab === "Privacy" && privacySection}
                {tab === "Storage" && storageSection}
                {tab === "Advanced" && advancedSection}
                {tab !== "Storage" && tab !== "Advanced" && (
                    <div className="sticky_save_bar">
                        {dirty && (
                            <span className="small_text right_spaced">
                                Unsaved changes
                            </span>
                        )}
                        <ButtonWithLoading
                            classNameArg="active max_width_col"
                            onClick={submit}
                            label="Save"
                        />
                    </div>
                )}
            </div>
        </>
    );
};
