import * as React from "react";
import { ButtonWithLoading, restartApp } from "./common";
import { HASH_ITERATIONS, SeedPhraseForm, hash } from "./common";
import { Infinity, Incognito, Ticket } from "./icons";
import { II_URL, II_DERIVATION_URL, MAINNET_MODE } from "./env";
import { Ed25519KeyIdentity } from "@dfinity/identity";

export const authMethods = [
    {
        icon: <Incognito />,
        label: "Password",
        login: async (confirmationRequired?: boolean): Promise<JSX.Element> => (
            <SeedPhraseForm
                classNameArg="spaced"
                callback={async (password: string) => {
                    if (!password) return;
                    let seed = await hash(password, HASH_ITERATIONS);
                    let identity = Ed25519KeyIdentity.generate(seed);
                    const isSecurePassword = (password: string): boolean =>
                        /^(?=.*?[A-Z])(?=.*?[0-9])(?=.*?[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]).{8,}$/.test(
                            password,
                        );
                    if (
                        MAINNET_MODE &&
                        !isSecurePassword(password) &&
                        !(await window.api.query("user", [
                            identity.getPrincipal().toString(),
                        ])) &&
                        !confirm(
                            "Your password is insecure and will eventually be guessed. " +
                                "A secure password should contain at least 8 symbols such as " +
                                "uppercase and lowercase letters, symbols and digits. " +
                                "Do you want to continue with an insecure password?",
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
        login: async () => {
            const code = prompt("Enter your invite code:")?.toLowerCase();
            if (!(await window.api.query("check_invite", code))) {
                alert("Invalid invite");
                return;
            }
            location.href = `#/welcome/${code}`;
            return <></>;
        },
    },
    {
        icon: <Infinity />,
        label: "Internet Identity",
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
    const methods = inviteMode
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
            {methods.map((method) => (
                <ButtonWithLoading
                    key={method.label}
                    classNameArg="large_text left_spaced right_spaced bottom_spaced"
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
            ))}
        </div>
    );
};
