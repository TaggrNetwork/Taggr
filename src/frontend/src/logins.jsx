import * as React from "react";
import {bigScreen} from "./common";
import {Infinity, Lock} from "./icons";

export const SEEDPHRASE_IDENTITY_KEY = "custom-identity";

export const authMethods = [
    {
        icon: <Infinity />,
        label: "INTERNET IDENTITY",
        explanation: "A login method provided by DFINITY. It uses secure hardware authentication devices (fingerprint sensors, YubiKey, etc.).",
        login: () => {
            if ((location.href.includes(".raw") || location.href.includes("share.")) &&
                confirm("You're using the uncertified insecure frontend. Do you want to be re-routed to the certified one?")) {
                location.href = location.href.replace(".raw", "");
                return;
            }
            authClient.login({
                onSuccess: () => location.reload(), 
                identityProvider: "https://identity.ic0.app/#authorize",
                maxTimeToLive: BigInt(30 * 24 * 3600000000000),
                derivationOrigin: `https://${process.env.CANISTER_ID}.ic0.app`
            });
            return null;
        },
        logout: async () => await authClient.logout(),
    },
    {
        icon: <Lock />,
        label: "SEED PHRASE",
        explanation: "A login method that uses any string-based phrase for the master key derivation. It's as secure as the used phrase.",
        login: () => <SeedPhraseForm callback={async seed => {
            if(!seed) return;
            const hash = await crypto.subtle.digest('SHA-256', (new TextEncoder()).encode(seed));
            localStorage.setItem(SEEDPHRASE_IDENTITY_KEY, (new TextDecoder("utf-8").decode(hash)))
            location.reload();
        }} />,
        logout: () => localStorage.removeItem(SEEDPHRASE_IDENTITY_KEY),
    },
];

export const LoginMasks = ({}) => {
    const [mask, setMask] = React.useState(null);
    if (mask) return mask;
    return <div className={`vertically_spaced text_centered stands_out ${bigScreen() ? "" : "column_container"}`}>
        {authMethods.map((method, i) => 
        <button key={i} className={`large_text active left_half_spaced right_half_spaced ${!bigScreen() && i == 0 ? "bottom_spaced" :""}`}
            onClick={() => setMask(method.login())}>
            {method.icon} {`${method.label}`}
        </button>)}
    </div>;
}

export const SeedPhraseForm = ({callback}) => {
    const [value, setValue] = React.useState("");
    const field = React.useRef();
    React.useEffect(() => field.current.focus(), []);
    return <div className="row_container spaced vertically_spaced">
        <input ref={field} onChange={e => setValue(e.target.value)}
            onKeyPress={e => { if(e.charCode == 13) callback(value)}}
            className="max_width_col" 
            type="password" placeholder="Enter your seedphrase..." />
        <button className="active" onClick={() => callback(value)}>JOIN</button>
    </div>;
}
