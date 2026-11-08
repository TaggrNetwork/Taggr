import * as React from "react";
import { loadFile } from "./form";
import {
    BurgerButton,
    ButtonWithLoading,
    confirmPopUp,
    noiseControlBanner,
    HeadBar,
    Loading,
    RealmSpan,
    setTitle,
    ToggleButton,
    foregroundColor,
    contrast,
    handleError,
    showPopUp,
    domain,
} from "./common";
import { Content } from "./content";
import { Close } from "./icons";
import { getTheme, setRealmUI } from "./theme";
import { Realm, Theme, UserFilter } from "./types";
import {
    USER_CACHE,
    UserList,
    populateUserNameCache,
    userNameToIds,
} from "./user_resolve";

let timer: any = null;
// The realm form debounces its inputs separately from the realms list
// (and from each other) so that pending updates don't cancel out.
let controllersTimer: any = null;
let whitelistTimer: any = null;

export const RealmForm = ({ existingName }: { existingName?: string }) => {
    const editing = !!existingName;
    const userId = window.user.id;

    const [theme, setTheme] = React.useState<Theme>();
    const [name, setName] = React.useState("");
    const [realm, setRealm] = React.useState<Realm>({
        cleanup_penalty: 10,
        controllers: [userId],
        description: "",
        filter: {
            age_days: 0,
            safe: false,
            balance: 0,
            num_followers: 0,
        },
        label_color: "#ffffff",
        logo: "",
        max_downvotes: window.backendCache.config.default_max_downvotes,
        num_members: 0,
        num_posts: 0,
        theme: "",
        whitelist: [],
        last_setting_update: 0,
        last_update: 0,
        revenue: 0,
        created: 0,
        posts: [],
        adult_content: false,
        comments_filtering: true,
    });
    const [controllersString, setControllersString] = React.useState("");
    const [whitelistString, setWhitelistString] = React.useState("");

    const loadRealm = async () => {
        let result =
            (await window.api.query<Realm[]>("realms", [existingName])) || [];
        const realm: Realm = result[0];
        if (existingName) setName(existingName);
        setRealm(realm);
        setStrings(realm);
        if (realm.theme) setTheme(JSON.parse(realm.theme));
        return realm;
    };

    const setStrings = async (realm: Realm) => {
        await populateUserNameCache(realm.whitelist.concat(realm.controllers));
        setWhitelistString(
            realm.whitelist.map((id) => `${USER_CACHE[id]}`).join(", "),
        );
        setControllersString(
            realm.controllers.map((id) => `${USER_CACHE[id]}`).join(", "),
        );
    };

    React.useEffect(() => {
        if (editing) loadRealm();
    }, []);

    const {
        logo,
        description,
        whitelist,
        filter,
        label_color,
        cleanup_penalty,
        adult_content,
        comments_filtering,
        max_downvotes,
    } = realm;

    const valid =
        !!name &&
        !!description &&
        (!!controllersString.trim() || realm.controllers.length > 0);
    return (
        <div className="spaced">
            <h2 className="vcentered">
                {logo && (
                    <img
                        alt="Logo"
                        className="right_spaced realm_logo"
                        src={`data:image/png;base64, ${logo}`}
                    />
                )}
                <span className="max_width_col">
                    {editing ? "Edit realm " + name : "Create a realm"}
                </span>
            </h2>
            <div className="column_container">
                {editing && (
                    <div className="column_container bottom_spaced">
                        <div className="bottom_half_spaced">
                            Logo (
                            {`${
                                window.backendCache.config.max_realm_logo_len /
                                1024
                            }`}
                            KB MAX, resize{" "}
                            <a href="https://imageresizer.com">here</a>)
                        </div>
                        <input
                            type="file"
                            aria-label="Realm logo"
                            onChange={async (ev: any) => {
                                const file = (ev.dataTransfer || ev.target)
                                    .files[0];
                                const content = new Uint8Array(
                                    await loadFile(file),
                                );
                                const actualSize = content.byteLength,
                                    expectedSize =
                                        window.backendCache.config
                                            .max_realm_logo_len;
                                if (
                                    content.byteLength >
                                    window.backendCache.config
                                        .max_realm_logo_len
                                ) {
                                    showPopUp(
                                        "error",
                                        `Logo size must be below ${Math.ceil(
                                            expectedSize / 1024,
                                        )}KB, while yours has ${Math.ceil(
                                            actualSize / 1024,
                                        )}KB.`,
                                        5,
                                    );
                                    return;
                                }
                                realm.logo = btoa(
                                    String.fromCharCode.apply(
                                        null,
                                        new Uint8Array(
                                            content,
                                        ) as unknown as number[],
                                    ),
                                );
                                setRealm({ ...realm });
                            }}
                        />
                    </div>
                )}
                {!editing && (
                    <div className="column_container bottom_spaced">
                        <label
                            className="bottom_half_spaced"
                            htmlFor="realm-name"
                        >
                            Realm name
                            {name.length >
                                window.backendCache.config.max_realm_name && (
                                <span>
                                    &nbsp;[⚠️ Must be{" "}
                                    {window.backendCache.config.max_realm_name}{" "}
                                    characters or less!]
                                </span>
                            )}
                        </label>
                        <input
                            id="realm-name"
                            placeholder="alphanumeric"
                            type="text"
                            value={name}
                            onChange={(event) => {
                                const name = event.target.value.toUpperCase();
                                setName(name);
                            }}
                        />
                    </div>
                )}
                <div className="bottom_spaced vcentered">
                    <label
                        className="max_width_col"
                        htmlFor="realm-label-colour"
                    >
                        Label colour
                    </label>
                    <input
                        id="realm-label-colour"
                        type="color"
                        className="top_half_spaced"
                        value={label_color}
                        onChange={(ev) => {
                            realm.label_color = ev.target.value;
                            setRealm({ ...realm });
                        }}
                    />
                    <RealmSpan
                        classNameArg="realm_tag"
                        background={label_color}
                        name={name}
                    />
                </div>
                <div className="column_container bottom_spaced">
                    <label
                        className="bottom_half_spaced"
                        htmlFor="realm-description"
                    >
                        Description
                    </label>
                    <textarea
                        id="realm-description"
                        data-testid="realm-textarea"
                        rows={10}
                        value={description}
                        onChange={(event) => {
                            realm.description = event.target.value;
                            setRealm({ ...realm });
                        }}
                    ></textarea>
                </div>
                <div className="framed bottom_spaced">
                    <Content value={description} preview={true} />
                </div>
                <div className="column_container bottom_spaced">
                    <div className="bottom_half_spaced">Adult content</div>
                    <select
                        aria-label="Adult content"
                        value={adult_content.toString()}
                        className="bottom_spaced"
                        onChange={(e) => {
                            realm.adult_content = e.target.value == "true";
                            setRealm({ ...realm });
                        }}
                    >
                        <option value="true">Yes</option>
                        <option value="false">No</option>
                    </select>
                </div>
                <div className="column_container bottom_spaced">
                    <label
                        className="bottom_half_spaced"
                        htmlFor="realm-cleanup-penalty"
                    >
                        Realm clean-up penalty (credits)
                    </label>
                    <input
                        id="realm-cleanup-penalty"
                        type="number"
                        min="0"
                        value={cleanup_penalty}
                        onChange={(e) => {
                            realm.cleanup_penalty = Number(e.target.value);
                            setRealm({ ...realm });
                        }}
                    />
                </div>
                <div className="column_container bottom_spaced">
                    <label
                        className="bottom_half_spaced"
                        htmlFor="realm-controllers"
                    >
                        Realm controllers (comma-separated)
                    </label>
                    <input
                        id="realm-controllers"
                        type="text"
                        value={controllersString}
                        onChange={(event) => {
                            clearTimeout(controllersTimer);
                            const input = event.target.value;
                            setControllersString(input);

                            controllersTimer = setTimeout(async () => {
                                // @ts-ignore
                                realm.controllers = await userNameToIds(
                                    input.split(/[,\s]+/).filter(Boolean),
                                );
                                setRealm({ ...realm });
                            }, 500);
                        }}
                    />
                    {realm.controllers.length > 0 && (
                        <div className="top_half_spaced">
                            Valid users: <UserList ids={realm.controllers} />
                        </div>
                    )}
                </div>
                <hr />
                <h2>Realm contributor settings</h2>
                <div className="column_container bottom_spaced">
                    <label
                        className="bottom_half_spaced"
                        htmlFor="realm-whitelist"
                    >
                        Only white listed users (comma-separated)
                    </label>
                    <input
                        id="realm-whitelist"
                        type="text"
                        value={whitelistString}
                        onChange={(event) => {
                            clearTimeout(whitelistTimer);
                            const input = event.target.value;
                            setWhitelistString(input);

                            whitelistTimer = setTimeout(async () => {
                                // @ts-ignore
                                realm.whitelist = await userNameToIds(
                                    input.split(/[,\s]+/).filter(Boolean),
                                );
                                setRealm({ ...realm });
                            }, 500);
                        }}
                    />
                    {realm.whitelist.length > 0 && (
                        <div className="top_half_spaced">
                            Valid users: <UserList ids={realm.whitelist} />
                        </div>
                    )}
                </div>

                {whitelist.length == 0 && (
                    <>
                        <div className="column_container bottom_spaced">
                            <div className="vcentered">
                                <input
                                    type="checkbox"
                                    checked={filter.safe}
                                    onChange={() => {
                                        realm.filter.safe = !filter.safe;
                                        setRealm({ ...realm });
                                    }}
                                    id="safe"
                                />
                                <label
                                    className="left_half_spaced"
                                    htmlFor="safe"
                                >
                                    Allow posting for non-controversial users
                                    only
                                </label>
                            </div>
                        </div>
                        <div className="column_container bottom_spaced">
                            <label
                                className="bottom_half_spaced"
                                htmlFor="realm-filter-balance"
                            >
                                Minimal{" "}
                                {window.backendCache.config.token_symbol}{" "}
                                balance:
                            </label>
                            <input
                                id="realm-filter-balance"
                                type="number"
                                min="0"
                                value={filter.balance}
                                onChange={(e) => {
                                    realm.filter.balance = Number(
                                        e.target.value,
                                    );
                                    setRealm({ ...realm });
                                }}
                            />
                        </div>
                        <div className="column_container bottom_spaced">
                            <label
                                className="bottom_half_spaced"
                                htmlFor="realm-filter-age"
                            >
                                Minimal account age (days):
                            </label>
                            <input
                                id="realm-filter-age"
                                type="number"
                                min="0"
                                value={filter.age_days}
                                onChange={(e) => {
                                    realm.filter.age_days = Number(
                                        e.target.value,
                                    );
                                    setRealm({ ...realm });
                                }}
                            />
                        </div>
                        <div className="column_container bottom_spaced">
                            <label
                                className="bottom_half_spaced"
                                htmlFor="realm-filter-followers"
                            >
                                Minimal number of followers:
                            </label>
                            <input
                                id="realm-filter-followers"
                                type="number"
                                min="0"
                                value={filter.num_followers}
                                onChange={(e) => {
                                    realm.filter.num_followers = Number(
                                        e.target.value,
                                    );
                                    setRealm({ ...realm });
                                }}
                            />
                        </div>
                    </>
                )}
                <div className="column_container bottom_spaced">
                    <div className="vcentered">
                        <input
                            type="checkbox"
                            checked={!comments_filtering}
                            onChange={() => {
                                realm.comments_filtering =
                                    !realm.comments_filtering;
                                setRealm({ ...realm });
                            }}
                            id="comments_filtering"
                        />
                        <label
                            className="left_half_spaced"
                            htmlFor="comments_filtering"
                        >
                            Allow commenting to everyone
                        </label>
                    </div>
                </div>
                <div className="column_container bottom_spaced">
                    <label
                        className="bottom_half_spaced"
                        htmlFor="realm-max-downvotes"
                    >
                        Maximum number of downvotes for posts displayed:
                    </label>
                    <input
                        id="realm-max-downvotes"
                        type="number"
                        min="0"
                        value={max_downvotes}
                        onChange={(e) => {
                            realm.max_downvotes = Number(e.target.value);
                            setRealm({ ...realm });
                        }}
                    />
                </div>
                <hr />

                <h2>Colour theme</h2>
                <div className="vcentered">
                    <input
                        type="checkbox"
                        checked={!!theme}
                        onChange={() =>
                            setTheme(theme ? undefined : getTheme("classic"))
                        }
                        id="own_theme"
                    />
                    <label className="left_half_spaced" htmlFor="own_theme">
                        Use own theme
                    </label>
                </div>
                {theme && (
                    <div className="dynamic_table vertically_spaced">
                        <div className="db_cell">
                            Text
                            <input
                                type="color"
                                aria-label="Text"
                                value={theme.text}
                                onChange={(ev) =>
                                    setTheme({
                                        ...theme,
                                        text: ev.target.value,
                                    })
                                }
                            />
                        </div>
                        <div className="db_cell">
                            Background
                            <input
                                type="color"
                                aria-label="Background"
                                value={theme.background}
                                onChange={(ev) =>
                                    setTheme({
                                        ...theme,
                                        background: ev.target.value,
                                    })
                                }
                            />
                        </div>
                        <div className="db_cell">
                            Code & digits
                            <input
                                type="color"
                                aria-label="Code & digits"
                                value={theme.code}
                                onChange={(ev) =>
                                    setTheme({
                                        ...theme,
                                        code: ev.target.value,
                                    })
                                }
                            />
                        </div>
                        <div className="db_cell">
                            Link
                            <input
                                type="color"
                                aria-label="Link"
                                value={theme.clickable}
                                onChange={(ev) =>
                                    setTheme({
                                        ...theme,
                                        clickable: ev.target.value,
                                    })
                                }
                            />
                        </div>
                        <div className="db_cell">
                            Accent
                            <input
                                type="color"
                                aria-label="Accent"
                                value={theme.accent}
                                onChange={(ev: any) =>
                                    setTheme({
                                        ...theme,
                                        accent: ev.target.value,
                                    })
                                }
                            />
                        </div>
                    </div>
                )}

                <ButtonWithLoading
                    classNameArg={`top_spaced ${valid ? "active" : "inactive"}`}
                    onClick={async () => {
                        if (!valid) return;
                        // The inputs are debounced for the live preview; make
                        // sure the submitted lists match what is in the text
                        // fields even if SAVE is clicked before the debounce.
                        if (controllersString.trim())
                            realm.controllers = await userNameToIds(
                                controllersString
                                    .split(/[,\s]+/)
                                    .filter(Boolean),
                            );
                        realm.whitelist = await userNameToIds(
                            whitelistString.split(/[,\s]+/).filter(Boolean),
                        );
                        realm.theme = JSON.stringify(theme) || "";
                        const response = await window.api.call<any>(
                            editing ? "edit_realm" : "create_realm",
                            name,
                            realm,
                        );
                        if (handleError(response)) return;
                        if (!editing) {
                            await window.api.call(
                                "toggle_realm_membership",
                                name,
                            );
                        }
                        await Promise.all([
                            window.reloadCache(),
                            window.reloadUser(),
                        ]);
                        if (!editing) {
                            location.href = `#/realm/${name}`;
                        }
                        setRealmUI(name);
                    }}
                    label={editing ? "Save" : "Create"}
                />
            </div>
        </div>
    );
};

export const RealmHeader = ({
    name,
    heartbeat,
}: {
    name: string;
    heartbeat: any;
}) => {
    const [realm, setRealm] = React.useState<Realm>();
    const [loading, setLoading] = React.useState(false);
    const [showInfo, toggleInfo] = React.useState(false);

    const loadRealm = async () => {
        setLoading(true);
        let result = await window.api.query<Realm[]>("realms", [name]);
        setLoading(false);
        if (!result || result.length == 0) return;
        setRealm(result[0]);
    };

    React.useEffect(() => {
        loadRealm();
        toggleInfo(false);
    }, [name, heartbeat]);

    setTitle(`realm ${name}`);

    if (loading) return <Loading />;
    if (!realm) return null;

    const user = window.user;
    // The name reads as a cut-out of the realm's own page background: use the
    // effective background (user override wins, otherwise the realm theme).
    const override = user?.settings.overrideRealmColors == "true";
    const userTheme = getTheme(user?.settings.theme) || getTheme("dark");
    let realmBackground: string | undefined;
    if (realm.theme) {
        try {
            realmBackground = JSON.parse(realm.theme).background;
        } catch (err) {
            console.error("Invalid realm theme", err);
        }
    }
    // The cut-out only reads while it stays legible on the label colour: the
    // name is large text and the close glyph is non-text, so 3:1 is the AA
    // floor. Themes close to the label colour fall back to black/white.
    const cutOut = (override ? userTheme?.background : realmBackground) || "";
    const colors = {
        background: realm.label_color,
        color:
            cutOut && contrast(cutOut, realm.label_color) >= 3
                ? cutOut
                : foregroundColor(realm.label_color),
    };
    return (
        <div className="top_spaced">
            <HeadBar
                title={
                    <div
                        className="vcentered max_width_col clickable"
                        onClick={() => (location.href = `#/realm/${name}`)}
                    >
                        {realm && realm.logo && (
                            <img
                                alt="Logo"
                                className="right_half_spaced realm_logo_small"
                                src={`data:image/png;base64, ${realm.logo}`}
                            />
                        )}
                        {name}
                    </div>
                }
                shareLink={`realm/${name.toLowerCase()}`}
                shareTitle={`Realm ${name} on ${window.backendCache.config.name}`}
                styleArg={colors}
                content={
                    <>
                        {!window.monoRealm && (
                            <ButtonWithLoading
                                styleArg={colors}
                                testId="realm-close-button"
                                onClick={async () => {
                                    window.realm = "";
                                    location.href = "/#/home";
                                }}
                                label={
                                    <Close styleArg={{ fill: colors.color }} />
                                }
                            />
                        )}
                        <BurgerButton
                            styleArg={colors}
                            onClick={() => toggleInfo(!showInfo)}
                            pressed={showInfo}
                            testId="realm-burger-button"
                        />
                    </>
                }
            />
            {showInfo && (
                <div className="stands_out">
                    <Content value={realm.description} />
                    Post eviction penalty: <code>{realm.cleanup_penalty}</code>
                    <hr />
                    <Restrictions realm={realm} />
                    <code>{realm.num_posts}</code> posts,{" "}
                    <code>{realm.num_members}</code> members, controlled by:{" "}
                    {realm.controllers.length == 0 ? (
                        "no one"
                    ) : (
                        <UserList ids={realm.controllers} />
                    )}
                    {user && (
                        <div className="row_container top_spaced flex_ended">
                            {realm.controllers.includes(user.id) && (
                                <button
                                    className="medium_text right_half_spaced"
                                    onClick={() => {
                                        location.href = `/#/realm/${name}/edit`;
                                        toggleInfo(false);
                                    }}
                                >
                                    Edit
                                </button>
                            )}
                            <ToggleButton
                                offLabel="Mute"
                                onLabel="Unmute"
                                classNameArg="right_half_spaced"
                                currState={() =>
                                    user.filters.realms.includes(name)
                                }
                                toggler={async () => {
                                    const response = await window.api.call(
                                        "toggle_filter",
                                        "realm",
                                        name,
                                    );
                                    if (handleError(response)) return false;
                                    await window.reloadUser();
                                    return true;
                                }}
                            />
                            {!user.realms.includes(name) && (
                                <ButtonWithLoading
                                    label="Join"
                                    classNameArg="active"
                                    onClick={async () => {
                                        if (
                                            !(await confirmPopUp(
                                                `By joining the realm ${name} you confirm that you understand its description ` +
                                                    `and agree with all terms and conditions mentioned there. ` +
                                                    `Any rule violation can lead to a moderation by stalwarts or ` +
                                                    `to realm controllers moving the post out of the realm which incurs ` +
                                                    `a penalty of ${realm.cleanup_penalty} credits and reward points.`,
                                            ))
                                        )
                                            return;
                                        await window.api
                                            .call(
                                                "toggle_realm_membership",
                                                name,
                                            )
                                            .then(window.reloadUser)
                                            .then(loadRealm);
                                        location.href = `#/realm/${name}`;
                                    }}
                                />
                            )}
                            {user.realms.includes(name) && (
                                <ButtonWithLoading
                                    classNameArg="active"
                                    label="Leave"
                                    onClick={async () => {
                                        await window.api
                                            .call(
                                                "toggle_realm_membership",
                                                name,
                                            )
                                            .then(window.reloadUser)
                                            .then(loadRealm);
                                        location.href = `#/home`;
                                    }}
                                />
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export const Realms = () => {
    const [realms, setRealms] = React.useState<[string, Realm][]>([]);
    const [page, setPage] = React.useState(0);
    const [filter, setFilter] = React.useState("");
    const [order, setOrder] = React.useState("popularity");
    const [noMoreData, setNoMoreData] = React.useState(false);
    const [loading, setLoading] = React.useState(false);
    // Identifies the latest request so stale responses can be discarded.
    const reqId = React.useRef(0);
    const loadRealms = async () => {
        const id = ++reqId.current;
        const data =
            (filter
                ? await window.api.query<any>(
                      "realm_search",
                      domain(),
                      order,
                      filter,
                  )
                : await window.api.query<any>(
                      "all_realms",
                      domain(),
                      order,
                      page,
                  )) || [];
        // Drop the response if a newer load has started meanwhile.
        if (id !== reqId.current) return;
        setNoMoreData(data.length == 0);
        // When filtering, the backend returns the full match set (page is
        // ignored), so always replace; only paginated listing appends.
        setRealms(page == 0 || filter ? data : realms.concat(data));
        setLoading(false);
    };

    React.useEffect(() => {
        loadRealms();
    }, [page, order]);

    React.useEffect(() => {
        setLoading(true);
        clearTimeout(timer);
        timer = setTimeout(() => {
            if (page != 0) setPage(0);
            else loadRealms();
        }, 500);
    }, [filter]);

    const user = window.user;
    const unset = (filter: UserFilter) =>
        !filter.safe &&
        filter.age_days == 0 &&
        filter.balance == 0 &&
        filter.num_followers == 0;
    const matchingRealms = realms.filter(
        ([name, { description }]) =>
            !filter ||
            (name.toLowerCase() + description.toLowerCase()).includes(filter),
    );
    return (
        <>
            <HeadBar
                title="Realms"
                shareLink="realms"
                content={
                    user && (
                        <button
                            className="medium_text active"
                            onClick={() => (location.href = "/#/realms/create")}
                        >
                            Create
                        </button>
                    )
                }
            />
            <div className="spaced row_container bottom_spaced">
                <input
                    className="right_half_spaced max_width_col"
                    type="search"
                    aria-label="Search realms"
                    placeholder="Search realms..."
                    value={filter}
                    onChange={(e: any) =>
                        setFilter(e.target.value.toLowerCase())
                    }
                />
                <select
                    value={order}
                    onChange={(e: any) => {
                        setOrder(e.target.value);
                        setPage(0);
                    }}
                >
                    <option value="popularity">Popularity</option>
                    <option value="activity">Last update</option>
                    <option value="name">Name</option>
                </select>
            </div>
            <div>
                {loading && <Loading />}
                {matchingRealms.map(([name, realm]) => {
                    return (
                        <div key={name} className="stands_out clickable">
                            <h3
                                className="vcentered clickable"
                                onClick={() => {
                                    location.href = `#/realm/${name}`;
                                }}
                            >
                                {realm.logo && (
                                    <img
                                        alt="Logo"
                                        className="right_spaced realm_logo"
                                        src={`data:image/png;base64, ${realm.logo}`}
                                    />
                                )}
                                <div className="row_container max_width_col">
                                    <a className="max_width_col">{name}</a>
                                    {realm.adult_content && (
                                        <span
                                            className="padded_rounded vcentered small_text left_half_spaced"
                                            style={{
                                                background: "black",
                                                color: "red",
                                                border: "1px solid red",
                                            }}
                                        >
                                            NSFW
                                        </span>
                                    )}
                                    {user && user.realms.includes(name) && (
                                        <span
                                            className="padded_rounded vcentered small_text left_half_spaced"
                                            style={{
                                                background: "green",
                                                color: "#55ff55",
                                                border: "1px solid #55ff55",
                                            }}
                                        >
                                            Joined
                                        </span>
                                    )}
                                    {unset(realm.filter) && (
                                        <span
                                            className="padded_rounded vcentered small_text left_half_spaced"
                                            style={{
                                                background: "rgb(120, 85, 10)",
                                                color: "orange",
                                                border: "1px solid orange",
                                            }}
                                        >
                                            Unrestricted
                                        </span>
                                    )}
                                </div>
                            </h3>
                            <div className="bottom_spaced">
                                <Content
                                    value={realm.description.split("\n")[0]}
                                />
                            </div>
                            Post eviction penalty:{" "}
                            <code>{realm.cleanup_penalty}</code>
                            <hr />
                            <Restrictions realm={realm} />
                            <>
                                <code>{realm.num_posts}</code> posts,{" "}
                                <code>{realm.num_members}</code> members,
                                controlled by:{" "}
                                <UserList ids={realm.controllers} />
                            </>
                        </div>
                    );
                })}
                {!loading && matchingRealms.length == 0 && (
                    <div
                        className="text_centered vertically_spaced small_text"
                        role="status"
                    >
                        No realms found.
                    </div>
                )}
            </div>
            {!noMoreData && !filter && (
                <div className="hcentered">
                    <ButtonWithLoading
                        classNameArg="active"
                        onClick={async () => setPage(page + 1)}
                        label="More"
                    />
                </div>
            )}
        </>
    );
};

const Restrictions = ({ realm }: { realm: Realm }) => {
    const restrictions = [];
    const { age_days, safe, balance, num_followers } = realm.filter;
    if (safe)
        restrictions.push(
            <>Users without reports and positive rewards balance.</>,
        );
    if (num_followers > 0)
        restrictions.push(<>Minimal number of followers: {num_followers}</>);
    if (age_days > 0) restrictions.push(<>Minimal account age: {age_days}</>);
    if (balance > 0)
        restrictions.push(
            <>
                Minimal {window.backendCache.config.token_symbol} balance:{" "}
                {balance}
            </>,
        );
    if (realm.whitelist.length > 0)
        restrictions.push(
            <>
                Whitelisted users: <UserList ids={realm.whitelist} />
            </>,
        );
    if (restrictions.length == 0) return null;
    return (
        <>
            {" "}
            <h3>Realm access restrictions</h3>
            <ul>
                {restrictions.map((line, i) => (
                    <li key={i}>{line}</li>
                ))}
            </ul>
            {noiseControlBanner("realm", realm.filter, window.user)}
            <hr />
        </>
    );
};
