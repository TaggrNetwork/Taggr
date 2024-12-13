import * as React from "react";
import {
    bigScreen,
    ButtonWithLoading,
    CopyToClipboard,
    HeadBar,
    Loading,
} from "./common";
import { Credits } from "./icons";
import { UserList } from "./user_resolve";

interface Invite {
    credits: number;
    credits_per_user: number;
    joined_user_ids: number[];
    realm_id?: string | null | undefined;
    inviter_user_id: number;
    dirty: boolean;
}

export const Invites = () => {
    const [credits, setCredits] = React.useState(
        window.backendCache.config.min_credits_for_inviting,
    );
    const [credits_per_user, setCreditsPerUser] = React.useState(
        window.backendCache.config.min_credits_for_inviting,
    );
    const [inviteRealm, setInviteRealm] = React.useState("");
    const [invites, setInvites] = React.useState<[string, Invite][]>([]);
    const [busy, setBusy] = React.useState(false);

    const loadInvites = async () => {
        setInvites((await window.api.query("invites")) || []);
    };

    React.useEffect(() => {
        loadInvites();
    }, []);

    const create = async () => {
        setBusy(true);
        const result = await window.api.call<any>(
            "create_invite",
            credits,
            credits_per_user,
            inviteRealm,
        );
        if ("Err" in result) alert(`Failed: ${result.Err}`);
        else loadInvites();
        setBusy(false);
    };

    const saveInvites = async () => {
        for (const i in invites) {
            const [code, invite] = invites[i];
            if (!invite.dirty) continue;
            const response = await window.api.call<any>(
                "update_invite",
                code,
                invite.credits !== undefined && invite.credits >= 0
                    ? invite.credits
                    : null,
                invite.realm_id !== undefined ? invite.realm_id : null,
            );
            if ("Err" in (response || {})) {
                alert(`Error: ${response.Err}`);
                setBusy(true);
                await loadInvites(); // Set back to prior state
                setBusy(false);
                return;
            }
        }
        await loadInvites();
    };

    const updateInvite = (
        id: string,
        field: "credits" | "realm_id",
        value: any,
    ) => {
        for (const i in invites) {
            const [code, invite] = invites[i];
            if (code != id) continue;
            // @ts-ignore
            invite[field] = value;
            invite.dirty = true;
            setInvites([...invites]);
            return;
        }
    };

    return (
        <>
            <HeadBar title="INVITES" shareLink="invites" />
            <div className="spaced bottom_spaced">
                <div className="stands_out">
                    <h2>Invite creation</h2>
                    <ul>
                        <li>
                            You can invite new users to{" "}
                            {window.backendCache.config.name} by creating
                            invites for them.
                        </li>
                        <li>
                            Every invite is a pre-charged with at least{" "}
                            <code>
                                {
                                    window.backendCache.config
                                        .min_credits_for_inviting
                                }
                            </code>{" "}
                            credits: you will be charged once the invite is
                            used.
                        </li>
                        <li>
                            One invite can be used by multiple users, each
                            receiving a pre-defined amount of credits.
                        </li>
                        <li>
                            The invite will not work if your credit balance
                            drops below the amount attached to the invite.
                        </li>
                        <li>
                            In an invite specifies a realm, users joining via
                            this invite will automatically join the realm.
                        </li>
                        <li>
                            Invites can be canceled by setting the credits to 0.
                        </li>
                    </ul>
                    <div className="column_container">
                        Total credits
                        <input
                            type="number"
                            value={credits}
                            className="max_width_col top_spaced bottom_spaced"
                            onChange={(event) =>
                                setCredits(parseInt(event.target.value))
                            }
                        />
                        Spend per user
                        <input
                            type="number"
                            value={credits_per_user}
                            className="max_width_col top_spaced bottom_spaced"
                            onChange={(event) =>
                                setCreditsPerUser(parseInt(event.target.value))
                            }
                        />
                        Realm (optional)
                        <input
                            type="text"
                            value={inviteRealm}
                            className="max_width_col top_spaced bottom_spaced"
                            onChange={(event) =>
                                setInviteRealm(
                                    event.target.value
                                        .replaceAll("/", "")
                                        .toUpperCase(),
                                )
                            }
                        />
                        <ButtonWithLoading
                            classNameArg="active"
                            onClick={create}
                            label="CREATE"
                        />
                    </div>
                </div>
                {invites.length > 0 && <h3>Your invites</h3>}
                {busy && <Loading />}
                {!busy && invites.length > 0 && (
                    <div className="column_container">
                        <table style={{ width: "100%" }}>
                            <thead>
                                <tr>
                                    <th align="left">
                                        <Credits />
                                    </th>
                                    <th align="left">
                                        <Credits /> Per User
                                    </th>
                                    <th align="left">Realm</th>
                                    <th align="right">Users</th>
                                    <th align="right">Invite</th>
                                    <th align="right">URL</th>
                                </tr>
                            </thead>
                            <tbody>
                                {invites.map(
                                    ([
                                        code,
                                        {
                                            credits,
                                            credits_per_user,
                                            joined_user_ids,
                                            realm_id,
                                        },
                                    ]) => (
                                        <tr key={code}>
                                            <td align="left">
                                                <input
                                                    type="number"
                                                    style={{ width: "100px" }}
                                                    defaultValue={credits}
                                                    onBlur={(event) =>
                                                        updateInvite(
                                                            code,
                                                            "credits",
                                                            +event.target.value,
                                                        )
                                                    }
                                                />
                                            </td>
                                            <td align="left">
                                                <code>{credits_per_user}</code>
                                            </td>
                                            <td align="left">
                                                <input
                                                    type="text"
                                                    style={{ width: "100px" }}
                                                    defaultValue={
                                                        realm_id || ""
                                                    }
                                                    onBlur={(event) =>
                                                        updateInvite(
                                                            code,
                                                            "realm_id",
                                                            event.target.value
                                                                .toUpperCase()
                                                                .replaceAll(
                                                                    "/",
                                                                    "",
                                                                ),
                                                        )
                                                    }
                                                />
                                            </td>
                                            <td align="right">
                                                <UserList
                                                    ids={joined_user_ids}
                                                />
                                            </td>
                                            <td align="right">
                                                <CopyToClipboard
                                                    value={code.toUpperCase()}
                                                />
                                            </td>
                                            <td align="right">
                                                <CopyToClipboard
                                                    value={`${location.protocol}//${location.host}/#/welcome/${code}`}
                                                    displayMap={(url) =>
                                                        bigScreen()
                                                            ? url
                                                            : "<too long>"
                                                    }
                                                />
                                            </td>
                                        </tr>
                                    ),
                                )}
                            </tbody>
                        </table>
                        <ButtonWithLoading
                            classNameArg="active"
                            onClick={saveInvites}
                            label="SAVE"
                            disabled={
                                !invites.some(([_, invite]) => invite.dirty)
                            }
                        />{" "}
                    </div>
                )}
            </div>
        </>
    );
};
