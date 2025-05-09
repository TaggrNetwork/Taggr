import * as React from "react";
import { ButtonWithLoading, KNOWN_USER, restartApp, showPopUp } from "./common";
import { HASH_ITERATIONS, SeedPhraseForm, hash } from "./common";
import { Infinity, Incognito, Ticket } from "./icons";
import { II_URL, II_DERIVATION_URL, MAINNET_MODE } from "./env";
import { Ed25519KeyIdentity } from "@dfinity/identity";

export const authMethods = [
    {
        icon: <Incognito />,
        label: "Seed Phrase",
        description:
            "This connection method is based on a secret (your seed phrase) stored in your browser. It is convenient, self-custodial, but less secure.",
        login: async (confirmationRequired?: boolean): Promise<JSX.Element> => (
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
                        MAINNET_MODE &&
                        !isSecurePassword(seedphrase) &&
                        !isBIP39SeedPhrase(seedphrase) &&
                        !(await window.api.query("user", [
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
                    restartApp();
                }}
                confirmationRequired={confirmationRequired}
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
            "This connection method is using an NNS-controlled authentication service hosted on IC and based on biometric and other secure options.",
        login: async () => {
            if (
                (location.href.includes(".raw") ||
                    location.href.includes("share.")) &&
                confirm(
                    "You're using the uncertified insecure frontend. Do you want to be re-routed to the certified one?",
                )
            ) {
                location.href = location.href.replace(".raw", "");
                return null;
            }
            window.authClient.login({
                onSuccess: restartApp,
                identityProvider: II_URL,
                maxTimeToLive: BigInt(30 * 24 * 3600000000000),
                derivationOrigin: II_DERIVATION_URL,
            });
            return null;
        },
    },
];

export const LoginMasks = ({
    confirmationRequired,
    parentCallback,
}: {
    confirmationRequired?: boolean;
    parentCallback?: () => void;
}) => {
    const [mask, setMask] = React.useState<JSX.Element>();
    const inviteMode = confirmationRequired;
    const knownUser = localStorage.getItem(KNOWN_USER) == "1";
    const methods =
        inviteMode || knownUser
            ? authMethods.filter((method) => method.label != "Invite")
            : authMethods;

    React.useEffect(() => {
        const logo = document.getElementById("connect_logo");
        if (!logo || !parentCallback) return;
        logo.innerHTML = window.backendCache.config.logo;
    }, []);

    return mask ? (
        mask
    ) : (
        <div className="vertically_spaced text_centered column_container">
            <span id="connect_logo"></span>
            <p className="vertically_spaced">Choose your connection method.</p>
            {methods.map((method) => (
                <div className="left_spaced right_spaced bottom_spaced">
                    <ButtonWithLoading
                        key={method.label}
                        classNameArg="active large_text"
                        styleArg={{ width: "100%" }}
                        onClick={async () => {
                            let mask = await method.login(confirmationRequired);
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
                    {!knownUser && (
                        <p className="small_text">{method.description}</p>
                    )}{" "}
                </div>
            ))}
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
