import * as React from "react";
import {ButtonWithLoading, FileUploadInput, HeadBar} from "./common";

export const Recovery = () => {
    const [hash, setHash] = React.useState("");
    return <>
        <HeadBar title="Recovery" />
        <div className="spaced">
            <h1>Status</h1>
            <code>{backendCache.stats.emergency_release}</code>
            <h1>Emergency binary</h1>
            <FileUploadInput callback={async binary => {
                await api.set_emergency_release(binary);
                alert("Done!");
            }} />
            <h1>Confirm binary</h1>
            <input type="text" value={hash} onChange={e => setHash(e.target.value)} />
            <ButtonWithLoading onClick={async () => await api.call("confirm_emergency_release", hash)} label="SUBMIT" />
        </div>
    </>;
}
