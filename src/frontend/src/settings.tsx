import * as React from "react";
import { ButtonWithLoading, HeadBar } from "./common";
import { User } from "./types";

export const Settings = ({ invite = null }) => {
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

    const updateData = (user: User) => {
        if (!user) return;
        setName(user.name);
        setAbout(user.about);
        setControllers(user.controllers.join("\n"));
        setSettings(user.settings);
    };

    React.useEffect(() => updateData(user), [user]);

    const setSetting = (key: string, e: any) => {
        const newSettings: { [name: string]: string } = {};
        Object.keys(settings).forEach((k) => (newSettings[k] = settings[k]));
        newSettings[key] = e.target.value;
        setSettings(newSettings);
        if (["theme", "columns"].includes(key)) setUIRefresh(true);
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
                invite,
            );
            if ("Err" in response) {
                return alert(`Error: ${response.Err}`);
            }
        }
        const nameChange = user && user.name != name;
        if (nameChange) {
            if (
                !confirm(
                    `A name change incurs costs of ${window.backendCache.config.name_change_cost} cycles. ` +
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
        const response = await window.api.call<any>(
            "update_user",
            nameChange ? name : "",
            about,
            principal_ids,
            JSON.stringify(settings),
        );
        if ("Err" in response) {
            alert(`Error: ${response.Err}`);
            return;
        }
        if (!user) location.href = "/";
        else if (uiRefresh) {
            await window.reloadUser();
            window.uiInitialized = false;
            window.setUI();
            updateData(window.user);
        }
    };

    return (
        <>
            <HeadBar title="SETTINGS" shareLink="setting" />
            <div className="spaced monospace column_container">
                <div className="bottom_half_spaced">
                    USER NAME <span className="accent">[required]</span>
                    <code className="left_spaced">{label}</code>
                </div>
                <input
                    type="text"
                    value={name}
                    className="monospace bottom_spaced"
                    placeholder="alphanumeric"
                    onChange={namePicker}
                />
                <div className="bottom_half_spaced">ABOUT YOU</div>
                <input
                    placeholder="you can use markdown, URLs, hashtags, ..."
                    className="monospace bottom_spaced"
                    type="text"
                    value={about}
                    onChange={(event) => setAbout(event.target.value)}
                />
                <div className="bottom_half_spaced">COLOR THEME</div>
                <select
                    value={settings.theme}
                    className="monospace bottom_spaced"
                    onChange={(event) => setSetting("theme", event)}
                >
                    <option value="auto">AUTO</option>
                    <option value="light">LIGHT</option>
                    <option value="dark">DARK</option>
                    <option value="classic">CLASSIC</option>
                    <option value="calm">CALM</option>
                    <option value="midnight">MIDNIGHT</option>
                </select>
                <div className="bottom_half_spaced">
                    MULTI-COLUMN VIEW ON LANDING:
                </div>
                <select
                    value={settings.columns}
                    className="monospace bottom_spaced"
                    onChange={(event) => setSetting("columns", event)}
                >
                    <option value="on">ON</option>
                    <option value="off">OFF</option>
                </select>
                <div className="bottom_half_spaced">
                    CONTROLLER PRINCIPALS (one per line)
                </div>
                <textarea
                    className="monospace small_text bottom_spaced"
                    value={controllers}
                    onChange={(event) => setControllers(event.target.value)}
                    rows={4}
                ></textarea>
                <ButtonWithLoading
                    classNameArg="active"
                    onClick={submit}
                    label="SAVE"
                />
                {window.user && (
                    <>
                        <hr />
                        <div className="bottom_half_spaced">PRINCIPAL</div>
                        <input
                            placeholder="Your principal"
                            className="monospace small_text"
                            type="text"
                            value={principal}
                            onChange={(event) =>
                                setPrincipal(event.target.value)
                            }
                        />
                        <div className="vertically_spaced">
                            ⚠️ Please note that changing your principal will
                            lead to the account loss if you do not control the
                            new principal!
                        </div>
                        {
                            <ButtonWithLoading
                                classNameArg={
                                    principal != window.principalId
                                        ? ""
                                        : "inactive"
                                }
                                onClick={async () => {
                                    let response = await window.api.call<any>(
                                        "change_principal",
                                        principal,
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
                    </>
                )}
            </div>
        </>
    );
};
