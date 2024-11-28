import * as React from "react";
import { ButtonWithLoading, bigScreen, createIdentityFromSeed } from "./common";
import { Infinity, Incognito, Ticket, Wallet as WalletIcon } from "./icons";
import { II_URL, II_DERIVATION_URL } from "./env";
import { BrowserProvider } from "ethers";
import { createSiweMessage, getNonce, verifyMessage } from "./siwe";

export const authMethods = [
    {
        icon: <WalletIcon />,
        label: "Browser Wallet",
        description:
            "An open source protocol that allows you to connect your crypto wallet to decentralized applications on the web.",
        login: async () => {
            // @ts-ignore
            const provider = new BrowserProvider(window.ethereum);

            const connectWallet = async () =>
                await provider
                    .send("eth_requestAccounts", [])
                    .catch(() => console.log("user rejected request"));

            async function signInWithEthereum() {
                const signer = await provider.getSigner();
                const nonce: string = await getNonce(signer.address);
                const message = createSiweMessage(
                    signer.address,
                    window.backendCache.config.siwe_statement,
                    nonce,
                );
                const signature = await signer.signMessage(message);
                await verifyMessage(message, signature);
            }

            await connectWallet();

            await signInWithEthereum();
        },
    },
    {
        icon: <Incognito />,
        label: "Password",
        description:
            "This authentication method works on any device and only requires you to memorize one password.",
        login: async (confirmationRequired?: boolean): Promise<JSX.Element> => (
            <SeedPhraseForm
                classNameArg="spaced"
                callback={async (seed) => {
                    await createIdentityFromSeed(
                        "SEED_PHRASE",
                        seed,
                        /* complexityCheck = */ true,
                    );
                    location.reload();
                }}
                confirmationRequired={confirmationRequired}
            />
        ),
    },
    {
        icon: <Ticket />,
        label: "Invite",
        description: "Start here if you got an invite code!",
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
                return null;
            }
            window.authClient.login({
                onSuccess: () => location.reload(),
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
}: {
    confirmationRequired?: boolean;
}) => {
    const [mask, setMask] = React.useState<JSX.Element>();
    if (mask) return mask;
    const inviteMode = confirmationRequired;
    const methods = inviteMode
        ? authMethods.filter((method) => method.label != "Invite")
        : authMethods;
    return (
        <div
            className={`vertically_spaced text_centered ${
                bigScreen() ? "" : "column_container"
            }`}
        >
            {methods.map((method, i) => (
                <div key={i} className="column_container stands_out">
                    <ButtonWithLoading
                        classNameArg="large_text left_half_spaced right_half_spaced"
                        onClick={async () => {
                            let mask = await method.login(confirmationRequired);
                            if (mask) setMask(mask);
                        }}
                        label={
                            <>
                                {method.icon} {method.label}
                            </>
                        }
                    />
                    <label className="top_spaced small_text">
                        {method.description}
                    </label>
                </div>
            ))}
        </div>
    );
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
        <div
            className={`${classNameArg} ${
                confirmationRequired ? "column_container" : "row_container"
            } vertically_spaced`}
        >
            <input
                ref={field as unknown as any}
                onChange={(e) => setValue(e.target.value)}
                onKeyPress={async (e) => {
                    if (!confirmationRequired && e.charCode == 13) {
                        let button = document.getElementById("login-button");
                        button?.click();
                    }
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
            <ButtonWithLoading
                id="login-button"
                classNameArg="active"
                onClick={async () => {
                    if (confirmationRequired && value != confirmedValue) {
                        alert("Passwords do not match.");
                        return;
                    }
                    await callback(value);
                }}
                label="JOIN"
            />
        </div>
    );
};
