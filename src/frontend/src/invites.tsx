import * as React from "react";
import {
    bigScreen,
    ButtonWithLoading,
    CopyToClipboard,
    HeadBar,
    Loading,
} from "./common";
import { Credits } from "./icons";

interface Invite {
    credits: number;
    credits_per_user: number;
    joined_user_ids: number[];
    realm_id?: string | null | undefined;
    inviter_user_id: number;
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

    const update = async (code: string) => {
        const updatedInvite = updatedInvites.find(
            ({ code: inviteCode }) => code === inviteCode,
        );
        if (!updatedInvite) {
            return;
        }
        return window.api
            .call<any>(
                "update_invite",
                code,
                updatedInvite.credits !== undefined &&
                    updatedInvite.credits >= 0
                    ? updatedInvite.credits
                    : null,
                updatedInvite.realm_id !== undefined
                    ? updatedInvite.realm_id
                    : null,
            )
            .then(async (response) => {
                if ("Err" in (response || {})) {
                    alert(`Error: ${response.Err}`);
                    setBusy(true);
                    await loadInvites(); // Set back to prior state
                    setBusy(false);
                }
            });
    };

    const updatedInvites: {
        code: string;
        credits?: number;
        realm_id?: string;
    }[] = [];

    const updateInviteValue = (
        code: string,
        field: "credits" | "realm_id",
        value: any,
    ) => {
        const updatedInvite = updatedInvites.find(
            ({ code: inviteCode }) => code === inviteCode,
        );
        if (updatedInvite) {
            updatedInvite[field] = value;
        } else {
            updatedInvites.push({ code, [field]: value });
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
                            this invite will automartically join the realm.
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
                                setInviteRealm(event.target.value)
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
                                <th align="right">CODE</th>
                                <th align="right">URL</th>
                                <th align="left">EDIT</th>
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
                                                    updateInviteValue(
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
                                                defaultValue={realm_id || ""}
                                                onBlur={(event) =>
                                                    updateInviteValue(
                                                        code,
                                                        "realm_id",
                                                        event.target.value,
                                                    )
                                                }
                                            />
                                        </td>
                                        <td align="right">
                                            {joined_user_ids.map((userId) => (
                                                <a
                                                    key={
                                                        userId + "_joined_user"
                                                    }
                                                    target="_blank"
                                                    href={`#/user/${userId}`}
                                                >
                                                    {userId}&nbsp;
                                                </a>
                                            ))}
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
                                        <td align="right">
                                            <ButtonWithLoading
                                                classNameArg="active"
                                                onClick={() => update(code)}
                                                label="EDIT"
                                            />
                                        </td>
                                    </tr>
                                ),
                            )}
                        </tbody>
                    </table>
                )}
            </div>
        </>
    );
};
