import * as React from "react";
import { CopyToClipboard, HeadBar, Loading } from "./common";
import { Cycles } from "./icons";
import { trusted } from "./profile";

export const Invites = () => {
    const [cycles, setCycles] = React.useState(
        backendCache.config.min_cycles_for_inviting
    );
    const [invites, setInvites] = React.useState([]);
    const [busy, setBusy] = React.useState(false);

    const loadInvites = async () => {
        setInvites(await api.query("invites"));
    };

    React.useEffect(() => {
        loadInvites();
    }, []);

    if (!trusted(api._user)) {
        return (
            <>
                <HeadBar title="Invites" shareLink="invites" />
                <div className="spaced">
                    Only trusted users can create invites.
                </div>
            </>
        );
    }

    return (
        <>
            <HeadBar title="Invites" shareLink="invites" />
            <div className="spaced">
                <h2>Create an invite</h2>
                <ul>
                    <li>
                        You can invite new users to {backendCache.config.name}{" "}
                        by creating invites for them.
                    </li>
                    <li>
                        Every invite is a funded by at least{" "}
                        <code>
                            {backendCache.config.min_cycles_for_inviting}
                        </code>{" "}
                        cycles: you will be charged once the invite is used.
                    </li>
                    <li>
                        Active users have a budget of free cycles for invites.
                        This budget is topped up weekly. Your current cycles
                        budget is <code>{api._user.invites_budget}</code>{" "}
                        cycles.
                    </li>
                    <li>
                        The invite will not work if your invite budget or cycle
                        balance drops below the amount attached to the invite.
                    </li>
                    <li>Invites are not cancelable.</li>
                </ul>
                <div className="vcentered">
                    <input
                        type="number"
                        value={cycles}
                        className="max_width_col"
                        onChange={(event) =>
                            setCycles(parseInt(event.target.value))
                        }
                    />
                    {!busy && (
                        <button
                            className="vertically_spaced active"
                            onClick={async () => {
                                setBusy(true);
                                const result = await api.call(
                                    "create_invite",
                                    cycles
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
                    <table className="monospace" style={{ width: "100%" }}>
                        <thead>
                            <tr>
                                <th align="right">
                                    <Cycles />
                                </th>
                                <th align="right">CODE</th>
                                <th align="right">URL</th>
                            </tr>
                        </thead>
                        <tbody>
                            {invites.map(([code, cycles]) => (
                                <tr key={code}>
                                    <td align="right">
                                        <code>{cycles}</code>
                                    </td>
                                    <td align="right">
                                        <CopyToClipboard
                                            value={code.toUpperCase()}
                                        />
                                    </td>
                                    <td align="right">
                                        <CopyToClipboard
                                            value={`${location.protocol}//${location.host}/#/welcome/${code}`}
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
