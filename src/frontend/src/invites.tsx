import * as React from "react";
import {
    bigScreen,
    ButtonWithLoading,
    CopyToClipboard,
    HeadBar,
    Loading,
    showPopUp,
} from "./common";
import { UserList } from "./user_resolve";

interface Invite {
    credits: number;
    credits_per_user: number;
    joined_user_ids: number[];
    realm_id?: string | null | undefined;
    inviter_user_id: number;
    dirty: boolean;
}

const InviteQRCard = ({ code }: { code: string }) => {
    React.useEffect(() => {
        const logo = document.getElementById(`logo_${code}`);
        if (!logo) return;
        logo.innerHTML = window.backendCache.config.logo;
    }, []);
    return (
        <div
            id={`qr_card_${code}`}
            className="vertically_spaced column_container framed centered framed"
            style={{
                color: "white",
                background: "black",
            }}
        >
            <span
                className="white_svg"
                style={{
                    width: "100%",
                    display: "inline-block",
                    transform: "scale(3)",
                    transformOrigin: "center",
                    marginTop: "5em",
                }}
                id={`logo_${code}`}
            ></span>
            <p className="vertically_spaced">Decentralized Social Network.</p>
            <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(`${location.protocol}//${location.host}/#/welcome/${code}`)}`}
                alt="QR Code for invite URL"
                style={{
                    maxWidth: "250px",
                    margin: "auto",
                }}
                loading="lazy"
            />
            <span
                className="vertically_spaced x_large_text"
                style={{
                    fontFamily: "Impact",
                    color: "orange",
                }}
            >
                JOIN WITH BITCOIN.
            </span>
        </div>
    );
};

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
        if ("Err" in result) showPopUp("error", result.Err);
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
                showPopUp("error", response.Err);
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
                            If an invite specifies a realm, users joining via
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
                                <div key={code} className="stands_out spaced">
                                    <div className="row_container">
                                        <div className="max_width_col">
                                            <div className="bottom_half_spaced">
                                                <strong>Credits:</strong>
                                                <input
                                                    type="number"
                                                    className="left_half_spaced max_width_col top_half_spaced"
                                                    defaultValue={credits}
                                                    onBlur={(event) =>
                                                        updateInvite(
                                                            code,
                                                            "credits",
                                                            +event.target.value,
                                                        )
                                                    }
                                                />
                                            </div>
                                            <div className="bottom_half_spaced top_half_spaced">
                                                <strong>
                                                    Credits Per User:
                                                </strong>{" "}
                                                <code>{credits_per_user}</code>
                                            </div>
                                            <div className="bottom_half_spaced">
                                                <strong>Realm:</strong>
                                                <input
                                                    type="text"
                                                    className="max_width_col top_half_spaced"
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
                                            </div>
                                            <div className="bottom_half_spaced">
                                                <strong>Users:</strong>
                                                <div className="top_half_spaced">
                                                    <UserList
                                                        ids={joined_user_ids}
                                                    />
                                                </div>
                                            </div>
                                            <div className="bottom_half_spaced">
                                                <strong>Invite Code:</strong>
                                                <CopyToClipboard
                                                    classNameArg="left_half_spaced"
                                                    value={code.toUpperCase()}
                                                />
                                            </div>
                                            <div>
                                                <strong>URL:</strong>
                                                <CopyToClipboard
                                                    classNameArg={`left_half_spaced ${bigScreen() ? "" : "small_text"}`}
                                                    value={`${location.protocol}//${location.host}/#/welcome/${code}`}
                                                />
                                            </div>
                                            <InviteQRCard code={code} />
                                        </div>
                                    </div>
                                </div>
                            ),
                        )}
                        <ButtonWithLoading
                            classNameArg="active"
                            onClick={saveInvites}
                            label="SAVE"
                            disabled={
                                !invites.some(([_, invite]) => invite.dirty)
                            }
                        />
                    </div>
                )}
            </div>
        </>
    );
};
