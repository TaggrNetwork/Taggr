import * as React from "react";
import {
    ButtonWithLoading,
    domain,
    restartApp,
    showPopUp,
    signOut,
    getCanonicalDomain,
    onCanonicalDomain,
} from "./common";
import { HASH_ITERATIONS, hash } from "./common";
import { Infinity, Incognito, Ticket } from "./icons";
import { II_URL } from "./env";
import { Ed25519KeyIdentity } from "@dfinity/identity";
import { DELEGATION_PRINCIPAL } from "./delegation";
import { instantiateApi } from ".";

export const authMethods = [
    {
        icon: <Incognito />,
        label: "Seed Phrase",
        description:
            "This connection method is based on a secret (your seed phrase) stored in your browser. It is convenient, self-custodial, but less secure.",
        login: async (signUp?: boolean): Promise<JSX.Element> => (
            <SeedPhraseForm
                classNameArg="spaced"
                callback={async (seedphrase: string) => {
                    if (!seedphrase) return;
                    let seed = await hash(seedphrase, HASH_ITERATIONS);
                    let identity = Ed25519KeyIdentity.generate(seed);
                    const isSecurePassword = (seedphrase: string): boolean =>
                        /^(?=.*?[A-Z])(?=.*?[0-9])(?=.*?[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]).{8,}$/.test(
                            seedphrase,
                        );
                    if (
                        signUp &&
                        !isSecurePassword(seedphrase) &&
                        !isBIP39SeedPhrase(seedphrase) &&
                        !(await window.api.query("user", "", [
                            identity.getPrincipal().toString(),
                        ])) &&
                        !confirm(
                            "Your seed phrase is insecure and will eventually be guessed. " +
                                "A secure seed phrase should be a valid BIP-39 phrase or " +
                                "contain at least 8 symbols such as uppercase and lowercase " +
                                "letters, symbols and digits. " +
                                "Do you want to continue with an insecure seed phrase?",
                        )
                    ) {
                        return;
                    }
                    let serializedIdentity = JSON.stringify(identity.toJSON());
                    localStorage.setItem("IDENTITY", serializedIdentity);
                    localStorage.setItem("SEED_PHRASE", "true");
                    await finalize(signUp);
                }}
                confirmationRequired={signUp}
            />
        ),
    },
    {
        icon: <Ticket />,
        label: "Invite",
        description:
            "If you have received an invite from someone, use this connection method.",
        login: async () => {
            const code = prompt("Enter your invite code:")?.toLowerCase();
            if (!(await window.api.query("check_invite", code))) {
                showPopUp("error", "Invalid invite");
                return;
            }
            location.href = `#/welcome/${code}`;
            return <></>;
        },
    },
    {
        icon: <Infinity />,
        label: "Internet Identity",
        description:
            "Passkey-based decentralized authentication service hosted on IC.",
        login: async (signUp?: boolean) => {
            if (
                (location.href.includes(".raw") ||
                    location.href.includes("share.")) &&
                confirm(
                    "You're using an uncertified, insecure frontend. Do you want to be re-routed to the certified one?",
                )
            ) {
                location.href = location.href.replace(".raw", "");
                return null;
            }
            window.authClient.login({
                onSuccess: () => finalize(signUp),
                identityProvider: II_URL,
                maxTimeToLive: BigInt(30 * 24 * 3600000000000),
                derivationOrigin: window.location.origin,
            });
            return null;
        },
    },
];

const finalize = async (signUp?: boolean) => {
    if (
        // in recovery mode, we do not instantiate this function
        window.reloadUser &&
        !signUp
    ) {
        await instantiateApi();
        await window.reloadUser();
        if (window.user)
            location.href = localStorage.getItem(DELEGATION_PRINCIPAL)
                ? "#/delegate"
                : "#/";
        else showPopUp("error", "User not found");
    } else restartApp();
};

export const LoginMasks = ({
    signUp,
    invite,
}: {
    signUp?: boolean;
    invite?: boolean;
}) => {
    const [mask, setMask] = React.useState<JSX.Element>();
    const methods =
        invite || !signUp
            ? authMethods.filter((method) => method.label != "Invite")
            : authMethods;

    return (
        <div className="vertically_spaced text_centered column_container">
            <h1>{signUp ? "Sign-up" : "Sign-in"}</h1>
            {mask ? (
                mask
            ) : (
                <>
                    {invite || signUp ? (
                        <p className="vertically_spaced">
                            {invite && (
                                <span>
                                    Welcome! You were invited to{" "}
                                    {window.backendCache.config.name}!
                                </span>
                            )}
                            <span>
                                Select one of the available authentication
                                methods to create your user account.
                            </span>
                        </p>
                    ) : (
                        <p className="vertically_spaced">
                            Choose your authentication method.
                        </p>
                    )}
                    {methods.map((method) => (
                        <div
                            key={method.label}
                            className="left_spaced right_spaced bottom_spaced"
                        >
                            <ButtonWithLoading
                                key={method.label}
                                classNameArg="active"
                                styleArg={{ width: "100%" }}
                                onClick={async () => {
                                    let mask = await method.login(signUp);
                                    if (mask) {
                                        setMask(mask);
                                    }
                                }}
                                label={
                                    <>
                                        {method.icon} {method.label}
                                    </>
                                }
                            />
                            {signUp && (
                                <p className="small_text">
                                    {method.description}
                                </p>
                            )}{" "}
                        </div>
                    ))}
                </>
            )}
        </div>
    );
};

/**
 * Validates if a string looks like a BIP-39 seed phrase
 * @param phrase The phrase to validate
 * @returns boolean indicating if the phrase appears to be a valid BIP-39 seed phrase
 */
function isBIP39SeedPhrase(phrase: string): boolean {
    const normalizedPhrase = phrase.trim().replace(/\s+/g, " ");
    const words = normalizedPhrase.split(" ");
    // Check word count (must be 12, 15, 18, 21 or 24 words)
    const validWordCounts = [12, 15, 18, 21, 24];
    if (!validWordCounts.includes(words.length)) {
        return false;
    }

    // Check each word (simple length validation)
    // BIP-39 words are typically 3-8 characters
    const invalidWords = words.filter(
        (word) => word.length < 3 || word.length > 8 || !/^[a-z]+$/.test(word),
    );

    return invalidWords.length === 0;
}

// On canonical domain it shows the sign-in page. On all other domains, it
// redirects for authorization of a delegation principal.
export const connect = () => {
    if (onCanonicalDomain()) {
        location.href = "#/sign-in";
        return;
    }

    // Generate a temporal identity
    const randomSeed = crypto.getRandomValues(new Uint8Array(32));
    let identity = Ed25519KeyIdentity.generate(randomSeed);
    let serializedIdentity = JSON.stringify(identity.toJSON());
    localStorage.setItem("IDENTITY", serializedIdentity);
    location.href = `https://${getCanonicalDomain()}/#/delegate/${domain()}/${identity.getPrincipal().toString()}`;

    return null;
};

export const SeedPhraseForm = ({
    callback,
    confirmationRequired,
    classNameArg,
}: {
    callback: (arg: string) => Promise<void>;
    confirmationRequired?: boolean;
    classNameArg?: string;
}) => {
    const [value, setValue] = React.useState("");
    const [confirmedValue, setConfirmedValue] = React.useState("");
    const field = React.useRef<HTMLInputElement>();
    React.useEffect(() => {
        let current = field.current;
        current?.focus();
    }, []);
    return (
        <>
            <p>
                Please enter your seed phrase{" "}
                {confirmationRequired && <>and confirm it</>}
            </p>
            <div
                className={`${classNameArg} column_container vertically_spaced`}
            >
                <input
                    ref={field as unknown as any}
                    onChange={(e) => setValue(e.target.value)}
                    onKeyPress={async (e) => {
                        if (!confirmationRequired && e.charCode == 13) {
                            let button =
                                document.getElementById("login-button");
                            button?.click();
                        }
                    }}
                    className="max_width_col bottom_spaced"
                    type="password"
                    placeholder="Enter your seed phrase..."
                />
                {confirmationRequired && (
                    <input
                        onChange={(e) => setConfirmedValue(e.target.value)}
                        className="max_width_col bottom_spaced"
                        type="password"
                        placeholder="Repeat your seed phrase..."
                    />
                )}
                <div className="row_container">
                    {window.principalId && (
                        <ButtonWithLoading
                            classNameArg="max_width_col"
                            onClick={signOut}
                            label="SIGN OUT"
                        />
                    )}
                    <ButtonWithLoading
                        id="login-button"
                        classNameArg="active left_half_spaced max_width_col"
                        onClick={async () => {
                            if (
                                confirmationRequired &&
                                value != confirmedValue
                            ) {
                                showPopUp(
                                    "error",
                                    "Seed phrases do not match.",
                                );
                                return;
                            }
                            await callback(value);
                        }}
                        label="CONTINUE"
                    />
                </div>
            </div>
        </>
    );
};
