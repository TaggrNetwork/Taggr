import * as React from "react";
import {
    hash,
    bigScreen,
    ButtonWithLoading,
    HeadBar,
    ICP_LEDGER_ID,
    hex,
} from "./common";
import { PFP, User, UserFilter, UserId } from "./types";
import { Principal } from "@dfinity/principal";
import { setTheme } from "./theme";
import { UserList } from "./user_resolve";
import { MAINNET_MODE } from "./env";

export const Settings = ({ invite }: { invite?: string }) => {
    const user = window.user;
    const [principal, setPrincipal] = React.useState(window.getPrincipalId());
    const [name, setName] = React.useState("");
    const [pfp, setPfp] = React.useState<PFP>({
        nonce: 0,
        palette_nonce: 2,
        colors: 3,
        genesis: true,
    });
    const [about, setAbout] = React.useState("");
    const [settings, setSettings] = React.useState<{ [name: string]: string }>(
        {},
    );
    const [controllers, setControllers] = React.useState("");
    const [encryptionPassword, setEncryptionPassword] = React.useState("");
    const [label, setLabel] = React.useState(null);
    const [timer, setTimer] = React.useState<any>();
    const [uiRefresh, setUIRefresh] = React.useState(false);
    const [governance, setGovernance] = React.useState("true");
    const [mode, setMode] = React.useState("Credits");
    const [showPostsInRealms, setShowPostsInRealms] = React.useState("true");
    const [userFilter, setUserFilter] = React.useState<UserFilter>({
        safe: false,
        age_days: 0,
        balance: 0,
        num_followers: 0,
    });

    const updateData = (user: User) => {
        if (!user) return;
        setName(user.name);
        setAbout(user.about);
        setPfp(user.pfp);
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
                return alert(`Error: ${response.Err}`);
            }
            registrationRealmId = response?.Ok;
        }

        const nameChange = !registrationFlow && user.name != name;
        if (nameChange) {
            if (
                !confirm(
                    `A name change incurs costs of ${window.backendCache.config.identity_change_cost} credits. ` +
                        `Moreover, the old name will still route to your profile. ` +
                        `Do you want to continue?`,
                )
            )
                return;
        }

        const pfpChange = user && !user.pfp.genesis && user.pfp != pfp;
        if (pfpChange) {
            if (
                !confirm(
                    `An avataggr change incurs costs of ${window.backendCache.config.identity_change_cost} credits. ` +
                        `Do you want to continue?`,
                )
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
                mode,
                showPostsInRealms == "true",
                pfp,
            ),
            window.api.call<any>("update_user_settings", settings),
        ]);
        for (let i in responses) {
            const response = responses[i];
            if ("Err" in response) {
                alert(`Error: ${response.Err}`);
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

    return (
        <>
            <HeadBar title="SETTINGS" shareLink="setting" />
            <div className="spaced column_container">
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
                {user && pfp && (
                    <>
                        <div className="bottom_half_spaced">Avataggr</div>
                        <Avataggr
                            userId={user.id}
                            pfp={pfp}
                            setPfp={(pfp) => setPfp({ ...pfp })}
                        />
                    </>
                )}
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
                            onChange={(event) =>
                                setGovernance(event.target.value)
                            }
                        >
                            <option value="true">YES</option>
                            <option value="false">NO</option>
                        </select>
                        <div className="bottom_half_spaced">
                            Your OpenChat User Id
                        </div>
                        <input
                            placeholder="Your Canister Id"
                            className="bottom_spaced"
                            type="text"
                            value={settings.open_chat}
                            onChange={(event) => setSetting("open_chat", event)}
                        />
                        <div className="bottom_half_spaced">
                            Reaction tap-and-hold delay (smaller is faster)
                        </div>
                        <input
                            className="bottom_spaced"
                            type="text"
                            value={
                                "tap_and_hold" in settings
                                    ? Number(settings.tap_and_hold)
                                    : 750
                            }
                            onChange={(event) =>
                                setSetting("tap_and_hold", event)
                            }
                        />
                    </>
                )}
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
                {user && (
                    <>
                        <div className="bottom_half_spaced">
                            Override realm color themes
                        </div>
                        <select
                            value={settings.overrideRealmColors || "false"}
                            className="bottom_spaced"
                            onChange={(event) =>
                                setSetting("overrideRealmColors", event)
                            }
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
                            Controller principal (one per line)
                        </div>
                        <textarea
                            className="small_text bottom_spaced"
                            value={controllers}
                            onChange={(event) =>
                                setControllers(event.target.value)
                            }
                            rows={4}
                        ></textarea>
                        <h3>Noise filter</h3>
                        <div className="stands_out">
                            <p>The noise filters define:</p>
                            <ul>
                                <li>
                                    actions of which users can trigger a
                                    notification in your inbox,
                                </li>
                                <li>
                                    posts of which users will appear in all tabs
                                    on your landing page.
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
                                    id="own_theme"
                                />
                                <label
                                    className="left_half_spaced"
                                    htmlFor="own_theme"
                                >
                                    Non-controversial users (without confirmed
                                    reports)
                                </label>
                            </div>
                        </div>
                        <div className="column_container bottom_spaced">
                            <div className="bottom_half_spaced">
                                Minimal{" "}
                                {window.backendCache.config.token_symbol}{" "}
                                balance:
                            </div>
                            <input
                                type="number"
                                min="0"
                                value={userFilter.balance}
                                onChange={(e) => {
                                    userFilter.balance = Number(e.target.value);
                                    setUserFilter({ ...userFilter });
                                }}
                                id="own_theme"
                            />
                        </div>
                        <div className="column_container bottom_spaced">
                            <div className="bottom_half_spaced">
                                Minimal account age (days):
                            </div>
                            <input
                                type="number"
                                min="0"
                                value={userFilter.age_days}
                                onChange={(e) => {
                                    userFilter.age_days = Number(
                                        e.target.value,
                                    );
                                    setUserFilter({ ...userFilter });
                                }}
                                id="own_theme"
                            />
                        </div>
                        <div className="column_container bottom_spaced">
                            <div className="bottom_half_spaced">
                                Minimal number of followers:
                            </div>
                            <input
                                type="number"
                                min="0"
                                value={userFilter.num_followers}
                                onChange={(e) => {
                                    userFilter.num_followers = Number(
                                        e.target.value,
                                    );
                                    setUserFilter({ ...userFilter });
                                }}
                                id="own_theme"
                            />
                        </div>
                        <div className="bottom_half_spaced">
                            Show posts from followed people posted in realms you
                            are not a member of:
                        </div>
                        <select
                            value={showPostsInRealms}
                            className="bottom_spaced"
                            onChange={(event) =>
                                setShowPostsInRealms(event.target.value)
                            }
                        >
                            <option value="true">YES</option>
                            <option value="false">NO</option>
                        </select>
                    </>
                )}
                <ButtonWithLoading
                    classNameArg="active"
                    onClick={submit}
                    label="SAVE"
                />
                {user && (
                    <div className="top_spaced column_container">
                        <h2>Muted Users</h2>
                        <div>
                            <UserList profile={true} ids={user.filters.users} />
                        </div>
                        <h2>Blocked Users</h2>
                        <div>
                            <UserList profile={true} ids={user.blacklist} />
                        </div>
                        <h2>Account suspension</h2>
                        <p>
                            You can suspend your account and encrypt all your
                            messages to make them inaccessible. If you ever plan
                            to activate your account again, make sure you can
                            recover this password later. An account
                            activation/deactivation costs{" "}
                            {window.backendCache.config.feature_cost} credits.
                        </p>
                        <input
                            placeholder="Encryption password"
                            className="bottom_spaced"
                            type="password"
                            value={encryptionPassword}
                            onChange={(event) =>
                                setEncryptionPassword(event.target.value)
                            }
                        />
                        <ButtonWithLoading
                            classNameArg={encryptionPassword ? "" : "inactive"}
                            onClick={async () => {
                                const seed = hex(
                                    Array.from(
                                        await hash(encryptionPassword, 1),
                                    ),
                                );
                                const result: any = await window.api.call(
                                    "crypt",
                                    seed,
                                );
                                const prefix = user.deactivated ? "de" : "en";
                                alert(
                                    result && "Ok" in result
                                        ? `${result.Ok} posts sucessfully ${prefix}crypted!`
                                        : `Error: ${prefix}cryption failed (${result?.Err || "wrong password?"})`,
                                );
                            }}
                            label={`${user.deactivated ? "AC" : "DEAC"}TIVATE`}
                        />
                        <h2>Principal Change</h2>
                        You can change your principal as follows:
                        <ol>
                            <li>
                                Log in using the new authentication method (a
                                new II anchor or a password).
                            </li>
                            <li>
                                Copy the displayed principal and log out again{" "}
                                <b>without creating a new user</b>.
                            </li>
                            <li>
                                Login back to your account using the old
                                authentication method and paste the new
                                principal in the text field below.
                            </li>
                            <li>Change the principal.</li>
                            <li>
                                Login with the new authentication method and
                                confirm the principal change.
                            </li>
                        </ol>
                        <div className="bottom_half_spaced">New principal</div>
                        <input
                            placeholder="Your principal"
                            className="bottom_spaced"
                            type="text"
                            value={principal}
                            onChange={(event) =>
                                setPrincipal(event.target.value)
                            }
                        />
                        {
                            <ButtonWithLoading
                                classNameArg={
                                    principal != window.getPrincipalId()
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
                                        alert(
                                            "Your ICP balance is not empty. Please withdraw all funds before changing the principal.",
                                        );
                                        return;
                                    }
                                    await window.api.call<any>(
                                        "request_principal_change",
                                        principal.trim(),
                                    );
                                    localStorage.clear();
                                    location.href = "/";
                                }}
                                label="CHANGE PRINCIPAL"
                            />
                        }
                    </div>
                )}
            </div>
        </>
    );
};

const Avataggr = ({
    userId,
    pfp,
    setPfp,
}: {
    userId: UserId;
    pfp: PFP;
    setPfp: (pfp: PFP) => void;
}) => {
    return (
        <div
            className={`${bigScreen() ? "row_container" : "column_container"} bottom_spaced top_spaced framed vcentered`}
        >
            {" "}
            <img
                height="128"
                width="128"
                style={{ margin: "0.5em" }}
                src={pfpPreviewUrl(
                    userId,
                    pfp.colors,
                    pfp.nonce,
                    pfp.palette_nonce,
                )}
            />
            <Slider
                label="Colors"
                value={pfp.colors}
                setValue={(val) => {
                    pfp.colors = val;
                    setPfp(pfp);
                }}
            />
            <Slider
                label="Palette"
                value={pfp.palette_nonce}
                setValue={(val) => {
                    pfp.palette_nonce = val;
                    setPfp(pfp);
                }}
            />
            <Slider
                label="Pattern"
                value={pfp.nonce}
                setValue={(val) => {
                    pfp.nonce = val;
                    setPfp(pfp);
                }}
            />
        </div>
    );
};

const Slider = ({
    label,
    value,
    setValue,
}: {
    label: string;
    value: number;
    setValue: (arg: number) => void;
}) => {
    return (
        <div className="left_spaced">
            {label}:
            <input
                type="number"
                style={{ margin: "0.5em", maxWidth: "5em" }}
                min="1"
                value={value}
                onChange={(e) => setValue(Number(e.target.value))}
            />
            <button onClick={() => setValue(Math.max(0, value - 1))}>🔽</button>
            <button onClick={() => setValue(value + 1)}>🔼</button>
        </div>
    );
};

function pfpPreviewUrl(
    userId: UserId,
    colors: number,
    nonce: number,
    palette_nonce: number,
) {
    const canisterId = window.backendCache.stats.canister_id;
    const host = MAINNET_MODE
        ? `https://${canisterId}.raw.icp0.io`
        : `http://127.0.0.1:8080`;
    return (
        `${host}/pfp_preview/${userId}/${colors}-${nonce}-${palette_nonce}` +
        (MAINNET_MODE ? "" : `?canisterId=${canisterId}`)
    );
}
