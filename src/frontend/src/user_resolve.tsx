import * as React from "react";
import { UserId, UserData, User } from "./types";
import { Loading, commaSeparated, pfpUrl } from "./common";

export const USER_CACHE: UserData = {};

export const populateUserNameCache = async (
    ids: UserId[],
    loadingCallback = (_arg: boolean) => {},
) => {
    const misses = ids.filter(
        (id) => id < Number.MAX_SAFE_INTEGER && !(id in USER_CACHE),
    );
    if (misses.length == 0) return;
    loadingCallback(true);
    const data = (await window.api.query<UserData>("users_data", misses)) || {};
    loadingCallback(false);
    Object.entries(data).forEach(
        ([id, name]: [string, string]) => (USER_CACHE[Number(id)] = name),
    );
};

export const userNameToIds = async (names: string[]) => {
    if (names.length == 0) return [];
    names = names.map((name) => name.trim().replace("@", ""));
    const cachedNames = Object.entries(USER_CACHE).reduce(
        (acc, [id, name]) => {
            acc[name] = Number(id);
            return acc;
        },
        {} as { [name: string]: UserId },
    );
    return (
        await Promise.all(
            names.map((name) =>
                name in cachedNames
                    ? { id: cachedNames[name] }
                    : window.api.query<User>("user", "", [name]),
            ),
        )
    )
        .map((user) => user?.id)
        .filter((user) => user != undefined);
};

export const UserLink = ({
    id,
    name,
    classNameArg,
    profile,
    pfpSize = 20,
    pfp = true,
}: {
    id: UserId;
    name?: string;
    classNameArg?: string;
    profile?: boolean;
    pfp?: boolean;
    pfpSize?: number;
}) => {
    const [loading, setLoading] = React.useState(false);
    const [userName, setUserName] = React.useState<string | null>(
        name || USER_CACHE[id] || null,
    );

    const loadUserName = async () => {
        if (name) USER_CACHE[id] = name;
        else await populateUserNameCache([id], setLoading);
        setUserName(USER_CACHE[id]);
    };

    React.useEffect(() => {
        if (id != undefined) loadUserName();
    }, []);

    React.useEffect(() => {
        setUserName(USER_CACHE[id]);
    }, [id]);

    if (loading) return <Loading spaced={false} />;

    return (
        <span className={`${classNameArg} user_link no_wrap`}>
            {pfp && validUserId(id) && (
                <img
                    className="pfp"
                    src={pfpUrl(id)}
                    height={pfpSize}
                    width={pfpSize}
                />
            )}
            {userName || validUserId(id) ? (
                <a href={`#/${profile ? "user" : "journal"}/${id}`}>
                    {userName || id}
                </a>
            ) : (
                "N/A"
            )}
            {id != null && BigInt(id) == u64max && (
                <span className="accent">
                    {window.backendCache.config.name.toUpperCase()}
                </span>
            )}
        </span>
    );
};

export const u64max = BigInt("18446744073709551615");

// In some cases we use anonymous user ids by using very large numbers (close to max uint64).
// Hence, we reserve the last 100 ids for these pruposes.
const validUserId = (id: number | null) =>
    id != null && BigInt(id) < u64max - BigInt(100);

export const UserList = ({
    ids = [],
    profile,
    showPfps,
}: {
    ids: UserId[];
    profile?: boolean;
    showPfps?: boolean;
}) => {
    const [loaded, setLoaded] = React.useState(false);

    const loadNames = async () => {
        await populateUserNameCache(ids);
        setLoaded(true);
    };

    React.useEffect(() => {
        loadNames();
    }, []);

    return !loaded ? (
        <Loading spaced={false} />
    ) : (
        commaSeparated(
            ids.map((id) => (
                <UserLink key={id} id={id} profile={profile} pfp={!!showPfps} />
            )),
        )
    );
};
