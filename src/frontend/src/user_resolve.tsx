import * as React from "react";
import { UserId, UserData, User } from "./types";
import { Loading, commaSeparated } from "./common";

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

export const userNameToIds = async (names: string[]) =>
    (
        await Promise.all(
            names
                .map((name) => name.trim().replace("@", ""))
                .map((name) => window.api.query<User>("user", [name])),
        )
    )
        .map((user) => user?.id)
        .filter((user) => user != undefined);

export const UserLink = ({
    id,
    classNameArg,
    profile,
    name,
}: {
    id: UserId;
    classNameArg?: string;
    profile?: boolean;
    name?: string;
}) => {
    const [loading, setLoading] = React.useState(false);

    const loadUserName = async () =>
        await populateUserNameCache([id], setLoading);

    React.useEffect(() => {
        if (name) USER_CACHE[id] = name;
        else loadUserName();
    }, [name]);

    if (loading) return <Loading spaced={false} />;

    return id in USER_CACHE ? (
        <a
            className={`${classNameArg} user_link`}
            href={`#/${profile ? "user" : "journal"}/${id}`}
        >
            {USER_CACHE[id]}
        </a>
    ) : (
        <span>N/A</span>
    );
};

export const UserList = ({
    ids = [],
    profile,
}: {
    ids: UserId[];
    profile?: boolean;
}) => {
    const [loading, setLoading] = React.useState(false);

    const loadNames = async () => await populateUserNameCache(ids, setLoading);

    React.useEffect(() => {
        loadNames();
    }, []);

    return loading ? (
        <Loading spaced={false} />
    ) : (
        commaSeparated(
            ids.map((id) => (
                <UserLink
                    key={id}
                    id={id}
                    name={USER_CACHE[id]}
                    profile={profile}
                />
            )),
        )
    );
};
