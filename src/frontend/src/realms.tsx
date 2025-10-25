import { Principal } from "@dfinity/principal";
import * as React from "react";
import { loadFile } from "./form";
import {
    BurgerButton,
    ButtonWithLoading,
    noiseControlBanner,
    HeadBar,
    Loading,
    RealmSpan,
    setTitle,
    ToggleButton,
    foregroundColor,
    showPopUp,
    domain,
    getCanistersMetaData,
    getUserTokens,
    icpSwapLogoFallback,
} from "./common";
import { Content } from "./content";
import { Close } from "./icons";
import { getTheme, setRealmUI } from "./theme";
import { Icrc1Canister, Realm, Theme, UserFilter } from "./types";
import {
    USER_CACHE,
    UserList,
    populateUserNameCache,
    userNameToIds,
} from "./user_resolve";
import { TokenSelect } from "./token-select";
import { CANISTER_ID } from "./env";

let timer: any = null;

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
        tokens: undefined,
    });
    const [controllersString, setControllersString] = React.useState("");
    const [whitelistString, setWhitelistString] = React.useState("");
    const [canistersMetaData, setCanisterMetaData] = React.useState<
        Record<string, Icrc1Canister>
    >({});

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

    const loadTokens = async (realm?: Realm) => {
        const canisterIds = new Set<string>([CANISTER_ID]);

        realm?.tokens?.forEach((id) => canisterIds.add(id));

        await getUserTokens(window?.user).then(async (tokens) => {
            tokens.forEach(({ canisterId }) => canisterIds.add(canisterId));
            window.user?.wallet_tokens?.forEach((id) => canisterIds.add(id));
        });

        const map = await getCanistersMetaData([...canisterIds]);
        setCanisterMetaData(Object.fromEntries(map));
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
        if (editing) loadRealm().then((r) => loadTokens(r));
        else loadTokens();
    }, []);

    const realmTokenInfo = (token: string): JSX.Element => {
        const metadata = canistersMetaData[token];
        if (!metadata) return <></>;
        return (
            <span key={token} className="right_spaced">
                <img
                    className="right_half_spaced"
                    style={{
                        height: 32,
                        width: 32,
                        verticalAlign: "middle",
                    }}
                    src={metadata.logo || icpSwapLogoFallback(token)}
                />
                <code>{metadata.symbol}</code>
            </span>
        );
    };

    const {
        logo,
        description,
        controllers,
        whitelist,
        filter,
        label_color,
        cleanup_penalty,
        adult_content,
        comments_filtering,
        max_downvotes,
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
                <div
                    className="bottom_spaced vcentered"
                    style={{ position: "relative" }}
                >
                    <div className="max_width_col">Label Color</div>
                    <input
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
                    <Content value={description} preview={true} />
                </div>
                <div className="column_container bottom_spaced">
                    <div className="bottom_half_spaced">Adult content</div>
                    <select
                        value={adult_content.toString()}
                        className="bottom_spaced"
                        onChange={(e) => {
                            realm.adult_content = e.target.value == "true";
                            setRealm({ ...realm });
                        }}
                    >
                        <option value="true">YES</option>
                        <option value="false">NO</option>
                    </select>
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
                            clearTimeout(timer);
                            const input = event.target.value;
                            setControllersString(input);

                            timer = setTimeout(async () => {
                                // @ts-ignore
                                realm.controllers = await userNameToIds(
                                    input.split(/[,\s]/),
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
                    <div className="bottom_half_spaced">
                        Only white listed users (comma-separated)
                    </div>
                    <input
                        type="text"
                        value={whitelistString}
                        onChange={(event) => {
                            clearTimeout(timer);
                            const input = event.target.value;
                            setWhitelistString(input);

                            timer = setTimeout(async () => {
                                // @ts-ignore
                                realm.whitelist = await userNameToIds(
                                    input.split(/[,\s]/),
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
                    <div className="bottom_half_spaced">
                        Maximum number of downvotes for posts displayed:
                    </div>
                    <input
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

                <h2>Tokens enabled for tipping</h2>
                <div className="column_container ">
                    {Object.keys(canistersMetaData).length > 0 && (
                        <div className="column_container ">
                            <TokenSelect
                                classNameArg="max_width_col"
                                canisters={Object.keys(canistersMetaData).map(
                                    (canisterId) => [
                                        canisterId,
                                        canistersMetaData[canisterId],
                                    ],
                                )}
                                onSelectionChange={(canisterId) => {
                                    if (realm.tokens?.includes(canisterId)) {
                                        return;
                                    }
                                    realm.tokens = [
                                        ...(realm.tokens || []),
                                        canisterId,
                                    ];
                                    setRealm({ ...realm });
                                }}
                            />
                            <input
                                type="hidden"
                                defaultValue={realm.tokens?.toString() || ""}
                                onBlur={async (e) => {
                                    const canisterIds =
                                        e.target.value
                                            ?.split(",")
                                            .filter(Boolean) || [];
                                    try {
                                        canisterIds.forEach(
                                            (canisterId) =>
                                                canisterId &&
                                                Principal.fromText(canisterId),
                                        ); // Try catch
                                        const metadata =
                                            await getCanistersMetaData(
                                                canisterIds,
                                            );
                                        if (!metadata) {
                                            return alert(
                                                "Could not find canister metadata",
                                            );
                                        }
                                        realm.tokens = [...canisterIds];

                                        canisterIds.forEach((canisterId) => {
                                            canistersMetaData[canisterId] =
                                                metadata.get(
                                                    canisterId,
                                                ) as Icrc1Canister;
                                        });
                                        setCanisterMetaData({
                                            ...canistersMetaData,
                                        });
                                        setRealm({ ...realm });
                                    } catch (e) {
                                        return alert(e);
                                    }
                                }}
                            />
                        </div>
                    )}
                    <div className="top_spaced vertically_aligned">
                        {realm.tokens?.length &&
                            realm.tokens.map((token) => realmTokenInfo(token))}
                    </div>
                </div>
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
                            showPopUp("error", response.Err);
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

    const colors = {
        background: realm.label_color,
        color: foregroundColor(realm.label_color),
    };
    const user = window.user;
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
                        {!window.monoRealm && window.defaultRealm != name && (
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
    const loadRealms = async () => {
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
                            className="medium_text active"
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
                                className="stands_out clickable"
                                style={{ position: "relative" }}
                            >
                                <h3
                                    className="vcentered clickable"
                                    onClick={() => {
                                        location.href = `#/realm/${name}`;
                                    }}
                                >
                                    {realm.logo && (
                                        <img
                                            alt="Logo"
                                            className="right_spaced"
                                            style={{ maxWidth: "70px" }}
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
