import * as React from "react";
import { ButtonWithLoading, FileUploadInput, HeadBar } from "./common";
import { LoginMasks } from "./authentication";
import { User } from "./types";

export const Recovery = () => {
    const [hash, setHash] = React.useState("");
    const [votes, setVotes] = React.useState<string[]>([]);
    const [status, setStatus] = React.useState<string>();
    const [user, setUser] = React.useState<User>();
    const [state, setState] = React.useState(0);

    const loadData = async () => {
        const user = await window.api.query<any>("user", "", []);
        setUser(user);
        if (user != undefined) {
            setState(1);
            const result =
                await window.api.query<[string, string[]]>("recovery_state");
            if (!result) return;
            const [status, votes] = result;
            setStatus(status);
            setVotes(votes);
        } else {
            setState(-1);
        }
    };

    React.useEffect(() => {
        loadData();
    }, []);

    if (state == 0) return null;
    else if (state == -1) return <LoginMasks />;

    return (
        <>
            <HeadBar title="RECOVERY" />
            Your principal id: {window.principalId}
            <div className="spaced">
                <h2>Status</h2>
                <code data-testid="status">{status}</code>
                <h2>Emergency binary</h2>
                <FileUploadInput
                    callback={async (binary) => {
                        if (
                            !confirm(
                                "Do you really want to upload a new binary? This will reset all existing votes.",
                            )
                        )
                            return;
                        await window.api.set_emergency_release(binary);
                        alert("Done!");
                    }}
                />
                {votes.length > 0 && (
                    <>
                        <h2 data-testid="supporters">Supporters</h2>
                        <ul>
                            {votes.map((id) => (
                                <li key={id}>{id}</li>
                            ))}
                        </ul>
                    </>
                )}
                {user && !votes.includes(user.principal) && (
                    <>
                        <h2>Confirm binary</h2>
                        <input
                            data-testid="hash-input"
                            type="text"
                            value={hash}
                            onChange={(e) => setHash(e.target.value)}
                        />
                        <ButtonWithLoading
                            onClick={async () => {
                                await window.api.call(
                                    "confirm_emergency_release",
                                    hash,
                                );
                                alert(
                                    "Your vote was submitted. If the hash was correct, your principal will appear in the list of supporters.",
                                );
                                location.reload();
                            }}
                            label="SUBMIT HASH"
                        />
                    </>
                )}
            </div>
        </>
    );
};
