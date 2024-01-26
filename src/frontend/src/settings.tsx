import * as React from "react";
import { ButtonWithLoading, HeadBar, ICP_LEDGER_ID } from "./common";
import { User, UserFilter } from "./types";
import { Principal } from "@dfinity/principal";
import { setTheme } from "./theme";

export const Settings = ({ invite }: { invite?: string }) => {
    const user = window.user;
    const [principal, setPrincipal] = React.useState(window.principalId);
    const [name, setName] = React.useState("");
    const [about, setAbout] = React.useState("");
    const [settings, setSettings] = React.useState<{ [name: string]: string }>(
        {},
    );
    const [controllers, setControllers] = React.useState("");
    const [label, setLabel] = React.useState(null);
    const [timer, setTimer] = React.useState<any>();
    const [uiRefresh, setUIRefresh] = React.useState(false);
    const [governance, setGovernance] = React.useState("true");
    const [showPostsInRealms, setShowPostsInRealms] = React.useState("true");
    const [userFilter, setUserFilter] = React.useState<UserFilter>({
        safe: false,
        age_days: 0,
        balance: 0,
        num_followers: 0,
        downvotes: 0,
    });

    const updateData = (user: User) => {
        if (!user) return;
        setName(user.name);
        setAbout(user.about);
        setControllers(user.controllers.join("\n"));
        setSettings(user.settings);
        setGovernance(user.governance.toString());
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
                                    "Err" in result ? result.Err : "free!",
                                ),
                            ),
                    300,
                ),
            );
        setName(name);
    };

    const submit = async () => {
        if (!user) {
            let response = await window.api.call<any>(
                "create_user",
                name,
                invite || "",
            );
            if ("Err" in response) {
                return alert(`Error: ${response.Err}`);
            }
        }
        const nameChange = user && user.name != name;
        if (nameChange) {
            if (
                !confirm(
                    `A name change incurs costs of ${window.backendCache.config.name_change_cost} credits. ` +
                        `Moreover, the old name will still route to your profile. ` +
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
            ),
            window.api.call<any>(
                "update_user_settings",
                settings,
                userFilter,
                governance == "true",
                showPostsInRealms == "true",
            ),
        ]);
        for (let i in responses) {
            const response = responses[i];
            if ("Err" in response) {
                alert(`Error: ${response.Err}`);
                return;
            }
        }
        if (!user || nameChange) location.href = "/";
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
                    </>
                )}
                <div className="bottom_half_spaced">Color theme</div>
                <select
                    value={settings.theme}
                    className="bottom_spaced"
                    onChange={(event) => {
                        const name = setSetting("theme", event);
                        setTheme(name);
                    }}
                >
                    <option value="black">BLACK</option>
                    <option value="calm">CALM</option>
                    <option value="classic">CLASSIC</option>
                    <option value="dark">DARK</option>
                    <option value="light">LIGHT</option>
                    <option value="midnight">MIDNIGHT</option>
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
                                    posts of which users will appear in the
                                    "NEW" tab on your landing page.
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
                                    Non-controversial users (without pending or
                                    confirmed reports and many downvotes)
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
                        <div className="column_container bottom_spaced">
                            <div className="bottom_half_spaced">
                                Maximal number of downvotes in the last{" "}
                                {
                                    window.backendCache.config
                                        .downvote_counting_period_days
                                }{" "}
                                days:
                            </div>
                            <input
                                type="number"
                                min="0"
                                value={userFilter.downvotes}
                                onChange={(e) => {
                                    userFilter.downvotes = Number(
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
                {window.user && (
                    <div className="top_spaced column_container">
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
                        </ol>
                        <div className="vertically_spaced banner">
                            Please note that changing your principal will lead
                            to the account loss{" "}
                            <b>if you do not control the new principal</b>!
                        </div>
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
                                        alert(
                                            "Your ICP balance is not empty. Please open your wallet and withdraw all funds before changing the principal.",
                                        );
                                        return;
                                    }
                                    const response = await window.api.call<any>(
                                        "change_principal",
                                        principal.trim(),
                                    );
                                    if ("Err" in response) {
                                        alert(`Error: ${response.Err}`);
                                        return;
                                    }
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
