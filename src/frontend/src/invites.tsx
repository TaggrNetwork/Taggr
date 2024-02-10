import * as React from "react";
import { bigScreen, CopyToClipboard, HeadBar, Loading } from "./common";
import { Credits } from "./icons";

export const Invites = () => {
    const [credits, setCredits] = React.useState(
        window.backendCache.config.min_credits_for_inviting,
    );
    const [invites, setInvites] = React.useState<[string, number][]>([]);
    const [busy, setBusy] = React.useState(false);

    const loadInvites = async () => {
        setInvites((await window.api.query("invites")) || []);
    };

    React.useEffect(() => {
        loadInvites();
    }, []);

    return (
        <>
            <HeadBar title="INVITES" shareLink="invites" />
            <div className="spaced">
                <h2>Create an invite</h2>
                <ul>
                    <li>
                        You can invite new users to{" "}
                        {window.backendCache.config.name} by creating invites
                        for them.
                    </li>
                    <li>
                        Every invite is a funded by at least{" "}
                        <code>
                            {
                                window.backendCache.config
                                    .min_credits_for_inviting
                            }
                        </code>{" "}
                        credits: you will be charged once the invite is used.
                    </li>
                    <li>
                        The invite will not work if your invite budget or credit
                        balance drops below the amount attached to the invite.
                    </li>
                    <li>Invites are not cancelable.</li>
                </ul>
                <div className="vcentered">
                    <input
                        type="number"
                        value={credits}
                        className="max_width_col"
                        onChange={(event) =>
                            setCredits(parseInt(event.target.value))
                        }
                    />
                    {!busy && (
                        <button
                            className="vertically_spaced active"
                            onClick={async () => {
                                setBusy(true);
                                const result = await window.api.call<any>(
                                    "create_invite",
                                    credits,
                                );
                                if ("Err" in result)
                                    alert(`Failed: ${result.Err}`);
                                else loadInvites();
                                setBusy(false);
                            }}
                        >
                            CREATE
                        </button>
                    )}
                </div>
                {invites.length > 0 && <h3>Your invites</h3>}
                {busy && <Loading />}
                {!busy && invites.length > 0 && (
                    <table style={{ width: "100%" }}>
                        <thead>
                            <tr>
                                <th align="right">
                                    <Credits />
                                </th>
                                <th align="right">CODE</th>
                                <th align="right">URL</th>
                            </tr>
                        </thead>
                        <tbody>
                            {invites.map(([code, credits]) => (
                                <tr key={code}>
                                    <td align="right">
                                        <code>{credits}</code>
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
                                                bigScreen() ? url : "<too long>"
                                            }
                                        />
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </>
    );
};
