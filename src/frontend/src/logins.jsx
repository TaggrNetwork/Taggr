import * as React from "react";
import { bigScreen } from "./common";
import { Infinity, Incognito, Ticket } from "./icons";
import { Ed25519KeyIdentity } from "@dfinity/identity";
import { II_URL, II_DERIVATION_URL } from "./env";

export const authMethods = [
    {
        icon: <Ticket />,
        label: "INVITE",
        description: "Start here if you got an invite code!",
        login: async () => {
            const code = prompt("Enter your invite code:").toLowerCase();
            if (!(await api.query("check_invite", code))) {
                alert("Invalid invite");
                return;
            }
            location.href = `#/welcome/${code}`;
            return <></>;
        },
    },
    {
        icon: <Infinity />,
        label: "INTERNET IDENTITY",
        description:
            "This authentication method is provided by the Internet Computer protocol and works well with any modern device supporting a biometric authentication.",
        login: () => {
            if (
                (location.href.includes(".raw") ||
                    location.href.includes("share.")) &&
                confirm(
                    "You're using the uncertified insecure frontend. Do you want to be re-routed to the certified one?",
                )
            ) {
                location.href = location.href.replace(".raw", "");
                return;
            }
            authClient.login({
                onSuccess: () => location.reload(),
                identityProvider: II_URL,
                maxTimeToLive: BigInt(30 * 24 * 3600000000000),
                derivationOrigin: II_DERIVATION_URL,
            });
            return null;
        },
    },
    {
        icon: <Incognito />,
        label: "PASSWORD",
        description:
            "This authentication method works on any device and only requires you to memorize one password.",
        login: async (confirmationRequired) => (
            <SeedPhraseForm
                callback={async (seed) => {
                    if (!seed) return;
                    const hash = new Uint8Array(
                        await crypto.subtle.digest(
                            "SHA-256",
                            new TextEncoder().encode(seed),
                        ),
                    );
                    let serializedIdentity = JSON.stringify(
                        Ed25519KeyIdentity.generate(hash).toJSON(),
                    );
                    localStorage.setItem("IDENTITY", serializedIdentity);
                    localStorage.setItem("SEED_PHRASE", true);
                    location.reload();
                }}
                confirmationRequired={confirmationRequired}
            />
        ),
    },
];

export const logout = () => {
    location.href = "/";
    localStorage.clear();
    authClient.logout();
};

export const LoginMasks = ({ confirmationRequired }) => {
    const [mask, setMask] = React.useState(null);
    if (mask) return mask;
    const inviteMode = confirmationRequired;
    const methods = inviteMode ? authMethods.slice(1) : authMethods;
    return (
        <div
            className={`vertically_spaced text_centered ${
                bigScreen() ? "" : "column_container"
            }`}
        >
            {methods.map((method, i) => (
                <div key={i} className="column_container stands_out">
                    <button
                        className="large_text active left_half_spaced right_half_spaced"
                        onClick={async () =>
                            setMask(await method.login(confirmationRequired))
                        }
                    >
                        {method.icon} {`${method.label}`}
                    </button>
                    <label className="top_spaced">{method.description}</label>
                </div>
            ))}
        </div>
    );
};

export const SeedPhraseForm = ({ callback, confirmationRequired }) => {
    const [value, setValue] = React.useState("");
    const [confirmedValue, setConfirmedValue] = React.useState("");
    const field = React.useRef();
    React.useEffect(() => field.current.focus(), []);
    return (
        <div
            className={`${
                confirmationRequired ? "column_container" : "row_container"
            } spaced vertically_spaced`}
        >
            <input
                ref={field}
                onChange={(e) => setValue(e.target.value)}
                onKeyPress={(e) => {
                    if (!confirmationRequired && e.charCode == 13)
                        callback(value);
                }}
                className="max_width_col"
                type="password"
                placeholder="Enter your password..."
            />
            {confirmationRequired && (
                <input
                    onChange={(e) => setConfirmedValue(e.target.value)}
                    className="max_width_col top_spaced bottom_spaced"
                    type="password"
                    placeholder="Repeat your password..."
                />
            )}
            <button
                className="active"
                onClick={() => {
                    if (confirmationRequired && value != confirmedValue) {
                        alert("Passwords do not match.");
                        return;
                    }
                    callback(value);
                }}
            >
                JOIN
            </button>
        </div>
    );
};
