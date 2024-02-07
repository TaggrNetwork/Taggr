import * as React from "react";
import { loadFile } from "./form";
import {
    BurgerButton,
    ButtonWithLoading,
    commaSeparated,
    noiseControlBanner,
    HeadBar,
    Loading,
    realmColors,
    RealmSpan,
    setTitle,
    ToggleButton,
    UserLink,
    userList,
} from "./common";
import { Content } from "./content";
import { Close } from "./icons";
import { getTheme, setRealmUI } from "./theme";
import { Realm, Theme, UserFilter, UserId } from "./types";

export const RealmForm = ({ existingName }: { existingName?: string }) => {
    const editing = !!existingName;
    const users = window.backendCache.users;
    const name2Id = Object.keys(users).reduce(
        (acc, idStr) => {
            let id = parseInt(idStr);
            acc[users[id].toLowerCase()] = id;
            return acc;
        },
        {} as { [name: string]: UserId },
    );
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
            downvotes: 0,
        },
        label_color: "#ffffff",
        logo: "",
        num_members: 0,
        num_posts: 0,
        theme: "",
        whitelist: [],
        last_setting_update: 0,
        last_update: 0,
        revenue: 0,
        last_root_post: 0,
    });
    const [controllersString, setControllersString] = React.useState(
        users[userId],
    );
    const [whitelistString, setWhitelistString] = React.useState("");

    const loadRealm = async () => {
        let result =
            (await window.api.query<Realm[]>("realms", [existingName])) || [];
        const realm: Realm = result[0];
        if (existingName) setName(existingName);
        setRealm(realm);
        if (realm.theme) setTheme(JSON.parse(realm.theme));
        setWhitelistString(realm.whitelist.map((id) => users[id]).join(", "));
        setControllersString(
            realm.controllers.map((id) => users[id]).join(", "),
        );
    };
    React.useEffect(() => {
        if (editing) loadRealm();
    }, []);
    const {
        logo,
        description,
        controllers,
        whitelist,
        filter,
        label_color,
        cleanup_penalty,
    } = realm;

    const valid = name && description && controllers.length > 0;
    return (
        <div className="spaced">
            <h2 className="vcentered">
                {logo && (
                    <img
                        alt="Logo"
                        className="right_spaced"
                        style={{ maxWidth: "70px" }}
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
                                    alert(
                                        `Logo size must be below ${Math.ceil(
                                            expectedSize / 1024,
                                        )}KB, while yours has ${Math.ceil(
                                            actualSize / 1024,
                                        )}KB.`,
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
                        <div className="bottom_half_spaced">
                            REALM NAME
                            {name.length >
                                window.backendCache.config.max_realm_name && (
                                <span>
                                    &nbsp;[⚠️ MUST BE{" "}
                                    {window.backendCache.config.max_realm_name}{" "}
                                    CHARACTERS OR LESS!]
                                </span>
                            )}
                        </div>
                        <input
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
                <div className="bottom_spaced" style={{ position: "relative" }}>
                    Label Color
                    <br />
                    <input
                        type="color"
                        value={label_color}
                        onChange={(ev) => {
                            realm.label_color = ev.target.value;
                            setRealm({ ...realm });
                        }}
                    />
                    <RealmSpan
                        classNameArg="realm_tag"
                        col={label_color}
                        name={name}
                    />
                </div>
                <div className="column_container bottom_spaced">
                    <div className="bottom_half_spaced">Description</div>
                    <textarea
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
                    <Content
                        value={description}
                        preview={true}
                        classNameArg="bottom_spaced"
                    />
                </div>
                <div className="column_container bottom_spaced">
                    <div className="bottom_half_spaced">
                        Realm clean-up penalty (credits)
                    </div>
                    <input
                        type="number"
                        min="0"
                        value={cleanup_penalty}
                        onChange={(e) => {
                            realm.cleanup_penalty = Number(e.target.value);
                            setRealm({ ...realm });
                        }}
                        id="own_theme"
                    />
                </div>
                <div className="column_container bottom_spaced">
                    <div className="bottom_half_spaced">
                        Realm controllers (comma-separated)
                    </div>
                    <input
                        type="text"
                        value={controllersString}
                        onChange={(event) => {
                            const input = event.target.value;
                            const ids = input
                                .split(",")
                                .map(
                                    (id) =>
                                        name2Id[
                                            id
                                                .replace("@", "")
                                                .trim()
                                                .toLowerCase()
                                        ],
                                )
                                .filter((n) => !isNaN(n));
                            setControllersString(input);
                            realm.controllers = ids;
                            setRealm({ ...realm });
                        }}
                    />
                    {controllers.length > 0 && (
                        <div className="column_container bottom_spaced">
                            <div className="bottom_half_spaced">
                                Recognized users: {userList(controllers)}
                            </div>
                        </div>
                    )}
                </div>
                <hr />
                <h2>Realm contributor settings</h2>
                <div className="column_container bottom_spaced">
                    <div className="bottom_half_spaced">
                        Only white listed users (comma-separated)
                    </div>
                    <input
                        type="text"
                        value={whitelistString}
                        onChange={(event) => {
                            const input = event.target.value;
                            const whitelist = input
                                .split(",")
                                .map(
                                    (id) =>
                                        name2Id[
                                            id
                                                .replace("@", "")
                                                .trim()
                                                .toLowerCase()
                                        ],
                                )
                                .filter((n) => !isNaN(n));
                            setWhitelistString(input);
                            realm.whitelist = whitelist;
                            setRealm({ ...realm });
                        }}
                    />
                    {whitelist.length > 0 && (
                        <div className="column_container bottom_spaced">
                            <div className="bottom_half_spaced">
                                Recognized users: {userList(whitelist)}
                            </div>
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
                                    id="own_theme"
                                />
                                <label
                                    className="left_half_spaced"
                                    htmlFor="own_theme"
                                >
                                    Non-controversial users (without reports and
                                    many downvotes)
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
                                value={filter.balance}
                                onChange={(e) => {
                                    realm.filter.balance = Number(
                                        e.target.value,
                                    );
                                    setRealm({ ...realm });
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
                                value={filter.age_days}
                                onChange={(e) => {
                                    realm.filter.age_days = Number(
                                        e.target.value,
                                    );
                                    setRealm({ ...realm });
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
                                value={filter.num_followers}
                                onChange={(e) => {
                                    realm.filter.num_followers = Number(
                                        e.target.value,
                                    );
                                    setRealm({ ...realm });
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
                                value={realm.filter.downvotes}
                                onChange={(e) => {
                                    realm.filter.downvotes = Number(
                                        e.target.value,
                                    );
                                    setRealm({ ...realm });
                                }}
                                id="own_theme"
                            />
                        </div>
                    </>
                )}
                <hr />

                <h2>Color Theme</h2>
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
                            TEXT
                            <input
                                type="color"
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
                            BACKGROUND
                            <input
                                type="color"
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
                            CODE & DIGITS
                            <input
                                type="color"
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
                            LINK
                            <input
                                type="color"
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
                            ACCENT
                            <input
                                type="color"
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
                        realm.theme = JSON.stringify(theme) || "";
                        const response = await window.api.call<any>(
                            editing ? "edit_realm" : "create_realm",
                            name,
                            realm,
                        );
                        if ("Err" in response) {
                            alert(`Error: ${response.Err}`);
                            return;
                        }
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
                    label={editing ? "SAVE" : "CREATE"}
                />
            </div>
        </div>
    );
};

export const RealmHeader = ({ name }: { name: string }) => {
    const [realm, setRealm] = React.useState<Realm>();
    const [showInfo, toggleInfo] = React.useState(false);

    const loadRealm = async () => {
        let result = (await window.api.query<Realm[]>("realms", [name])) || [];
        setRealm(result[0]);
    };

    React.useEffect(() => {
        loadRealm();
        toggleInfo(false);
    }, [name]);

    setTitle(`realm ${name}`);

    if (!realm) return <Loading />;

    const colors = realmColors(name);
    const user = window.user;
    return (
        <>
            <HeadBar
                title={
                    <div
                        className="vcentered max_width_col clickable"
                        onClick={() => (location.href = `#/realm/${name}`)}
                    >
                        {realm && realm.logo && (
                            <img
                                alt="Logo"
                                className="right_half_spaced"
                                style={{ maxWidth: "40px" }}
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
                        <ButtonWithLoading
                            styleArg={colors}
                            testId="realm-close-button"
                            onClick={async () => {
                                window.realm = "";
                                location.href = "/#/home";
                            }}
                            label={<Close styleArg={{ fill: colors.color }} />}
                        />
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
                    {userList(realm.controllers)}
                    {user && (
                        <div className="row_container top_spaced flex_ended">
                            {realm.controllers.includes(user.id) && (
                                <button
                                    className="right_half_spaced"
                                    onClick={() => {
                                        location.href = `/#/realm/${name}/edit`;
                                        toggleInfo(false);
                                    }}
                                >
                                    EDIT
                                </button>
                            )}
                            <ToggleButton
                                offLabel="MUTE"
                                onLabel="UNMUTE"
                                classNameArg="right_half_spaced"
                                currState={() =>
                                    user.filters.realms.includes(name)
                                }
                                toggler={() =>
                                    window.api
                                        .call("toggle_filter", "realm", name)
                                        .then(window.reloadUser)
                                }
                            />
                            {!user.realms.includes(name) && (
                                <ButtonWithLoading
                                    label="JOIN"
                                    classNameArg="active"
                                    onClick={async () => {
                                        if (
                                            !confirm(
                                                `By joining the realm ${name} you confirm that you understand its description ` +
                                                    `and agree with all terms and conditions mentioned there. ` +
                                                    `Any rule violation can lead to a moderation by stalwarts or ` +
                                                    `to realm controllers moving the post out of the realm which incurs ` +
                                                    `a penalty of ${realm.cleanup_penalty} credits and reward points.`,
                                            )
                                        )
                                            return;
                                        return window.api
                                            .call(
                                                "toggle_realm_membership",
                                                name,
                                            )
                                            .then(window.reloadUser)
                                            .then(loadRealm);
                                    }}
                                />
                            )}
                            {user.realms.includes(name) && (
                                <ButtonWithLoading
                                    classNameArg="active"
                                    label="LEAVE"
                                    onClick={async () =>
                                        window.api
                                            .call(
                                                "toggle_realm_membership",
                                                name,
                                            )
                                            .then(window.reloadUser)
                                            .then(loadRealm)
                                    }
                                />
                            )}
                        </div>
                    )}
                </div>
            )}
        </>
    );
};

let timer: any = null;

export const Realms = () => {
    const [realms, setRealms] = React.useState<[string, Realm][]>([]);
    const [page, setPage] = React.useState(0);
    const [filter, setFilter] = React.useState("");
    const [order, setOrder] = React.useState("popularity");
    const [noMoreData, setNoMoreData] = React.useState(false);
    const [loading, setLoading] = React.useState(false);
    const loadRealms = async () => {
        const data =
            (filter
                ? await window.api.query<any>("realm_search", filter)
                : await window.api.query<any>("all_realms", order, page)) || [];
        if (data.length == 0) {
            setNoMoreData(true);
        }
        setRealms(page == 0 ? data : realms.concat(data));
        setLoading(false);
    };

    React.useEffect(() => {
        loadRealms();
    }, [page, order]);

    React.useEffect(() => {
        setLoading(true);
        clearTimeout(timer);
        setTimeout(() => loadRealms(), 500);
    }, [filter]);

    const user = window.user;
    const unset = (filter: UserFilter) =>
        !filter.safe &&
        filter.downvotes == 0 &&
        filter.age_days == 0 &&
        filter.balance == 0 &&
        filter.num_followers == 0;
    return (
        <>
            <HeadBar
                title="REALMS"
                shareLink="realms"
                content={
                    user && (
                        <button
                            className="active"
                            onClick={() => (location.href = "/#/realms/create")}
                        >
                            CREATE
                        </button>
                    )
                }
            />
            <div className="spaced row_container bottom_spaced">
                <input
                    className="right_half_spaced max_width_col"
                    type="search"
                    placeholder={`Search realms...`}
                    value={filter}
                    onChange={(e: any) =>
                        setFilter(e.target.value.toLowerCase())
                    }
                />
                <select
                    className="small_text"
                    value={order}
                    onChange={(e: any) => {
                        setOrder(e.target.value);
                        setPage(0);
                    }}
                >
                    <option value="popularity">POPULARITY</option>
                    <option value="activity">LAST UPDATE</option>
                    <option value="name">NAME</option>
                </select>
            </div>
            <div>
                {loading && <Loading />}
                {realms
                    .filter(
                        ([name, { description }]) =>
                            !filter ||
                            (
                                name.toLowerCase() + description.toLowerCase()
                            ).includes(filter),
                    )
                    .map(([name, realm]) => {
                        return (
                            <div
                                key={name}
                                onClick={() => {
                                    location.href = `#/realm/${name}`;
                                }}
                                className="stands_out clickable"
                                style={{ position: "relative" }}
                            >
                                <h3 className="vcentered">
                                    {realm.logo && (
                                        <img
                                            alt="Logo"
                                            className="right_spaced"
                                            style={{ maxWidth: "70px" }}
                                            src={`data:image/png;base64, ${realm.logo}`}
                                        />
                                    )}
                                    <div className="row_container max_width_col">
                                        <div className="max_width_col">
                                            {name}
                                        </div>
                                        {user && user.realms.includes(name) && (
                                            <span
                                                className="padded_rounded vcentered small_text left_half_spaced"
                                                style={{
                                                    background: "green",
                                                    color: "#55ff55",
                                                    border: "1px solid #55ff55",
                                                }}
                                            >
                                                JOINED
                                            </span>
                                        )}
                                        {unset(realm.filter) && (
                                            <span
                                                className="padded_rounded vcentered small_text left_half_spaced"
                                                style={{
                                                    background:
                                                        "rgb(120, 85, 10)",
                                                    color: "orange",
                                                    border: "1px solid orange",
                                                }}
                                            >
                                                UNRESTRICTED
                                            </span>
                                        )}
                                    </div>
                                </h3>
                                <Content
                                    value={realm.description.split("\n")[0]}
                                    classNameArg="bottom_spaced"
                                />
                                Post eviction penalty:{" "}
                                <code>{realm.cleanup_penalty}</code>
                                <hr />
                                <Restrictions realm={realm} />
                                <>
                                    <code>{realm.num_posts}</code> posts,{" "}
                                    <code>{realm.num_members}</code> members,
                                    controlled by: {userList(realm.controllers)}
                                </>
                            </div>
                        );
                    })}
            </div>
            {!noMoreData && !filter && (
                <div style={{ display: "flex", justifyContent: "center" }}>
                    <ButtonWithLoading
                        classNameArg="active"
                        onClick={async () => setPage(page + 1)}
                        label="MORE"
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
                Whitelisted users:{" "}
                {commaSeparated(
                    realm.whitelist.map((id) => <UserLink id={id} />),
                )}
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
