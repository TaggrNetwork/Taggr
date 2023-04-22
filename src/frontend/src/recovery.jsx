import * as React from "react";
import {ButtonWithLoading, FileUploadInput, HeadBar} from "./common";

export const Recovery = () => {
    const [hash, setHash] = React.useState("");
    return <>
        <HeadBar title="Recovery" />
        <div className="spaced">
            <h2>Status</h2>
            <code>{backendCache.stats.emergency_release || "No emergencies today! ☀️"}</code>
            <h2>Emergency binary</h2>
            <FileUploadInput callback={async binary => {
                await api.set_emergency_release(binary);
                alert("Done!");
            }} />
            <h2>Confirm binary</h2>
            <input type="text" value={hash} onChange={e => setHash(e.target.value)} />
            <ButtonWithLoading onClick={async () => await api.call("confirm_emergency_release", hash)} label="SUBMIT" />
        </div>
    </>;
}
