import * as React from "react";
import { ButtonWithLoading, FileUploadInput, HeadBar } from "./common";

export const Recovery = () => {
    const [hash, setHash] = React.useState("");
    const { emergency_release, emergency_votes } = backendCache.stats;
    return (
        <>
            <HeadBar title="Recovery" />
            <div className="spaced">
                <h2>Status</h2>
                <code>{emergency_release || "No emergencies today! ☀️"}</code>
                <h2>Emergency binary</h2>
                <FileUploadInput
                    callback={async (binary) => {
                        if (
                            !confirm(
                                "Do you really want to upload a new binary? This will reset all existing votes."
                            )
                        )
                            return;
                        await api.set_emergency_release(binary);
                        alert("Done!");
                    }}
                />
                {emergency_votes.length > 0 && (
                    <>
                        <h2>Supporters</h2>
                        <ul className="monospace">
                            {emergency_votes.map((id) => (
                                <li key={id}>{id}</li>
                            ))}
                        </ul>
                    </>
                )}
                {api._user && !emergency_votes.includes(api._user.principal) && (
                    <>
                        <h2>Confirm binary</h2>
                        <input
                            type="text"
                            value={hash}
                            onChange={(e) => setHash(e.target.value)}
                        />
                        <ButtonWithLoading
                            onClick={async () => {
                                await api.call(
                                    "confirm_emergency_release",
                                    hash
                                );
                                alert(
                                    "Your vote was submitted. If the hash was correct, your principal will appear in the list of supporters."
                                );
                                location.reload();
                            }}
                            label="SUBMIT"
                        />
                    </>
                )}
            </div>
        </>
    );
};
