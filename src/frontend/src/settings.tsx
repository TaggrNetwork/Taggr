import * as React from "react";
import {
    hash,
    ButtonWithLoading,
    confirmPopUp,
    errorText,
    HeadBar,
    ICP_LEDGER_ID,
    hex,
    showPopUp,
    sizeMb,
    showCycles,
    onCanonicalDomain,
    UnavailableOnCustomDomains,
    tagList,
    RealmList,
    TabBar,
} from "./common";
import { CanisterStatus, User, UserFilter } from "./types";
import { Principal } from "@dfinity/principal";
import { setTheme } from "./theme";
import { UserList } from "./user_resolve";
import { UserLinks, linksError } from "./profile";
import { loadPendingPostIds, runMigration } from "./migration";
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

const MigrationPanel = ({ bucket }: { bucket: string }) => {
    const [pending, setPending] = React.useState<number[] | null>(null);
    const [done, setDone] = React.useState(0);
    const [runTotal, setRunTotal] = React.useState(0);
    const [running, setRunning] = React.useState(false);
    const stopRef = React.useRef(false);

    const refresh = React.useCallback(async () => {
        setPending(await loadPendingPostIds());
    }, []);

    React.useEffect(() => {
        refresh();
    }, [refresh]);

    const onMigrate = async () => {
        if (!pending) return;
        setDone(0);
        setRunTotal(pending.length);
        setRunning(true);
        stopRef.current = false;
        try {
            await runMigration(
                Principal.fromText(bucket),
                pending,
                (d) => setDone(d),
                () => stopRef.current,
            );
        } catch (err) {
            showPopUp("error", errorText(err), 7);
        } finally {
            setRunning(false);
            setPending(await loadPendingPostIds());
        }
    };

    const counterTotal = running || done > 0 ? runTotal : pending?.length || 0;

    if (pending === null) return null;
    if (pending.length === 0 && !running && done === 0) return null;

    return (
        <>
            <hr />
            <h3>Migration</h3>
            <p>
                Move images from the shared storage into your own storage. Safe
                to stop and resume — progress is server-side.
            </p>
            <p>
                Posts migrated:{" "}
                <code>
                    {done} / {counterTotal}
                </code>
            </p>
            {running ? (
                <ButtonWithLoading
                    classNameArg=""
                    onClick={async () => {
                        stopRef.current = true;
                    }}
                    label="STOP"
                />
            ) : (
                <ButtonWithLoading
                    classNameArg="active"
                    onClick={onMigrate}
                    label="MIGRATE"
                />
            )}
        </>
    );
};

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
            { confirmLabel: "TOP UP", cancelLabel: "CANCEL" },
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
            { confirmLabel: "UPGRADE", cancelLabel: "CANCEL" },
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
                            label="UPGRADE STORAGE"
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
                            className="selectable top_half_spaced"
                            style={{ wordBreak: "break-all" }}
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
                            label="ADD BLACKHOLE CONTROLLER"
                        />
                    )}
                </div>
            )}
            <div className="top_spaced column_container">
                <div className="bottom_half_spaced">Top up with cycles</div>
                <div className="row_container">
                    <input
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
                        label="TOP UP"
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
            {bucket ? (
                <MigrationPanel bucket={bucket} />
            ) : onCanonicalDomain() ? (
                <>
                    <div className="bottom_spaced">
                        Create a personal storage canister to attach images to
                        your posts.
                    </div>
                    <ButtonWithLoading
                        classNameArg="active max_width_col"
                        onClick={onCreate}
                        label="CREATE STORAGE"
                    />
                </>
            ) : (
                <UnavailableOnCustomDomains component="Storage creation" />
            )}
        </>
    );
};

const TABS = [
    "PROFILE",
    "APPEARANCE",
    "PRIVACY",
    "STORAGE",
    "ADVANCED",
] as const;
type Tab = (typeof TABS)[number];

export const Settings = ({
    invite,
    tab: initialTabProp,
}: {
    invite?: string;
    tab?: string;
}) => {
    const user = window.user;
    const [principal, setPrincipal] = React.useState(window.principalId);
    const [name, setName] = React.useState("");
    const [about, setAbout] = React.useState("");
    const [settings, setSettings] = React.useState<{ [name: string]: string }>(
        {},
    );
    const [controllers, setControllers] = React.useState("");
    const [encKey, setEncKey] = React.useState("");
    const [label, setLabel] = React.useState(null);
    const [timer, setTimer] = React.useState<any>();
    const [uiRefresh, setUIRefresh] = React.useState(false);
    const [governance, setGovernance] = React.useState("true");
    const [mode, setMode] = React.useState("Mining");
    const [showPostsInRealms, setShowPostsInRealms] = React.useState("true");
    const [userFilter, setUserFilter] = React.useState<UserFilter>({
        safe: false,
        age_days: 0,
        balance: 0,
        num_followers: 0,
    });
    const initialTab = (TABS as readonly string[]).includes(
        initialTabProp || "",
    )
        ? (initialTabProp as Tab)
        : "PROFILE";
    const [tab, setTab] = React.useState<Tab>(initialTab);

    const updateData = (user: User) => {
        if (!user) return;
        setName(user.name);
        setAbout(user.about);
        setControllers(user.controllers.join("\n"));
        setSettings(user.settings);
        setGovernance(user.governance.toString());
        setMode(user.mode);
        setShowPostsInRealms(user.show_posts_in_realms.toString());
        setUserFilter(user.filters.noise);
    };

    React.useEffect(() => updateData(user), [user]);

    const setSetting = (key: string, e: any) => {
        const newSettings: { [name: string]: string } = {};
        Object.keys(settings).forEach((k) => (newSettings[k] = settings[k]));
        newSettings[key] = e.target.value;
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
                            .then((result) =>
                                setLabel(
                                    "Err" in result ? result.Err : "available!",
                                ),
                            ),
                    300,
                ),
            );
        setName(name);
    };

    const submit = async () => {
        const registrationFlow = !user;
        let registrationRealmId: string | undefined;
        if (registrationFlow) {
            let response = await window.api.call<any>(
                "create_user",
                name,
                invite || "",
            );
            if ("Err" in response) {
                return showPopUp("error", response.Err);
            }
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

        const principal_ids = controllers
            .split("\n")
            .map((v) => v.trim())
            .filter((id) => id.length > 0);
        const responses = await Promise.all([
            window.api.call<any>(
                "update_user",
                nameChange ? name : "",
                about,
                principal_ids,
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
            if ("Err" in response) {
                showPopUp("error", response.Err);
                return;
            }
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
    };

    const profileSection = (
        <>
            <div className="bottom_half_spaced">
                User name <span className="accent">[required]</span>
                <code className="left_spaced">{label}</code>
            </div>
            <input
                type="text"
                value={name}
                className="bottom_spaced"
                placeholder="alphanumeric"
                onChange={namePicker}
            />
            <div className="bottom_half_spaced">About you</div>
            <input
                placeholder="tell us what we should know about you"
                className="bottom_spaced"
                type="text"
                value={about}
                onChange={(event) => setAbout(event.target.value)}
            />
            {user && (
                <>
                    <div className="bottom_half_spaced">Usage mode</div>
                    <select
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
                        value={governance}
                        className="bottom_spaced"
                        onChange={(event) => setGovernance(event.target.value)}
                    >
                        <option value="true">YES</option>
                        <option value="false">NO</option>
                    </select>
                    <div className="bottom_half_spaced">
                        Your links (one per line)
                    </div>
                    <textarea
                        placeholder="Twitter: https://twitter.com/user_name"
                        className="bottom_half_spaced"
                        rows={4}
                        value={settings.links || ""}
                        onChange={(event) => setSetting("links", event)}
                    ></textarea>
                    <div className="bottom_spaced">
                        {settings.links &&
                            (linksError(settings.links) ? (
                                <span className="error">
                                    {linksError(settings.links)}
                                </span>
                            ) : (
                                <UserLinks
                                    settings={settings}
                                    prefix="Links:"
                                />
                            ))}
                    </div>
                    <div className="bottom_half_spaced">
                        Enable ICRC tokens in the wallet
                    </div>
                    <select
                        data-testid="ic-wallet-select"
                        value={settings.icrcWallet || "false"}
                        className="bottom_spaced"
                        onChange={(event) => setSetting("icrcWallet", event)}
                    >
                        <option value="true">YES</option>
                        <option value="false">NO</option>
                    </select>
                    <div className="bottom_half_spaced">
                        Controller principal (one per line)
                    </div>
                    <textarea
                        className="small_text bottom_spaced"
                        value={controllers}
                        onChange={(event) => setControllers(event.target.value)}
                        rows={4}
                    ></textarea>
                </>
            )}
        </>
    );

    const appearanceSection = (
        <>
            <div className="bottom_half_spaced">Color scheme</div>
            <select
                value={settings.theme}
                className="bottom_spaced"
                onChange={(event) => {
                    const name = setSetting("theme", event);
                    setTheme(name);
                }}
            >
                <option value="dark">DARK</option>
                <option value="calm">CALM</option>
                <option value="midnight">MIDNIGHT</option>
                <option value="classic">CLASSIC</option>
                <option value="black">BLACK</option>
                <option value="light">LIGHT</option>
            </select>
            <div className="bottom_half_spaced">
                Override realm color themes
            </div>
            <select
                value={settings.overrideRealmColors || "false"}
                className="bottom_spaced"
                onChange={(event) => setSetting("overrideRealmColors", event)}
            >
                <option value="true">YES</option>
                <option value="false">NO</option>
            </select>
            <div className="bottom_half_spaced">
                Multi-column layout on landing page
            </div>
            <select
                value={settings.columns}
                className="bottom_spaced"
                onChange={(event) => setSetting("columns", event)}
            >
                <option value="on">ON</option>
                <option value="off">OFF</option>
            </select>
            <div className="bottom_half_spaced">
                Reaction tap-and-hold delay (smaller is faster)
            </div>
            <input
                className="bottom_spaced"
                type="text"
                value={
                    "tap_and_hold" in settings
                        ? Number(settings.tap_and_hold)
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
                value={showPostsInRealms}
                className="bottom_spaced"
                onChange={(event) => setShowPostsInRealms(event.target.value)}
            >
                <option value="true">YES</option>
                <option value="false">NO</option>
            </select>
            {user && user.filters.users.length > 0 && (
                <>
                    <h2>Muted Users</h2>
                    <div>
                        <UserList profile={true} ids={user.filters.users} />
                    </div>
                </>
            )}
            {user && user.blacklist.length > 0 && (
                <>
                    <h2>Blocked Users</h2>
                    <div>
                        <UserList profile={true} ids={user.blacklist} />
                    </div>
                </>
            )}
            {user && user.filters.tags.length > 0 && (
                <>
                    <h2>Muted Tags</h2>
                    <div>{tagList(user.filters.tags.map((tag) => [tag]))}</div>
                </>
            )}
            {user && user.filters.realms.length > 0 && (
                <>
                    <h2>Muted Realms</h2>
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
                    <input
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
                        label={`${user.deactivated ? "AC" : "DEAC"}TIVATE`}
                    />
                </>
            ) : (
                <UnavailableOnCustomDomains />
            )}
            <hr />
            <h2>Principal Change</h2>
            You can change your principal as follows:
            <ol>
                <li>
                    Log in using the new authentication method (a new II anchor
                    or a seed phrase).
                </li>
                <li>
                    Copy the displayed principal and log out again{" "}
                    <b>without creating a new user</b>.
                </li>
                <li>
                    Login back to your account using the old authentication
                    method and paste the new principal in the text field below.
                </li>
                <li>Change the principal.</li>
                <li>
                    Login with the new authentication method and confirm the
                    principal change.
                </li>
            </ol>
            {onCanonicalDomain() ? (
                <>
                    <div className="bottom_half_spaced">New principal</div>
                    <input
                        placeholder="Your principal"
                        className="bottom_spaced"
                        type="text"
                        value={principal}
                        onChange={(event) => setPrincipal(event.target.value)}
                    />
                    <ButtonWithLoading
                        classNameArg={
                            principal != window.principalId ? "" : "inactive"
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
                                        confirmLabel: "ADD CONTROLLER",
                                        cancelLabel: "ABORT",
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
                            if ("Err" in response) {
                                return showPopUp("error", response.Err);
                            }
                            localStorage.clear();
                            location.href = "/";
                        }}
                        label="CHANGE PRINCIPAL"
                    />
                </>
            ) : (
                <UnavailableOnCustomDomains />
            )}
        </>
    );

    // Registration flow: no tabs, just the profile fields and a save button.
    if (!user) {
        return (
            <>
                <HeadBar title="SETTINGS" shareLink="setting" />
                <div className="spaced column_container">
                    {profileSection}
                    <ButtonWithLoading
                        classNameArg="active top_spaced"
                        onClick={submit}
                        label="SAVE"
                    />
                </div>
            </>
        );
    }

    return (
        <>
            <HeadBar title="SETTINGS" shareLink="setting" />
            <div className="spaced column_container">
                <TabBar
                    tabs={[...TABS]}
                    activeTab={tab}
                    onTabChange={(t) => setTab(t as Tab)}
                />
                {tab === "PROFILE" && profileSection}
                {tab === "APPEARANCE" && appearanceSection}
                {tab === "PRIVACY" && privacySection}
                {tab === "STORAGE" && storageSection}
                {tab === "ADVANCED" && advancedSection}
                {tab !== "STORAGE" && tab !== "ADVANCED" && (
                    <div className="sticky_save_bar">
                        <ButtonWithLoading
                            classNameArg="active max_width_col"
                            onClick={submit}
                            label="SAVE"
                        />
                    </div>
                )}
            </div>
        </>
    );
};
