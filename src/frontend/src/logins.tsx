import * as React from "react";
import {
    ButtonWithLoading,
    HASH_ITERATIONS,
    ICP_LEDGER_ID,
    bigScreen,
    hash,
    popUp,
} from "./common";
import { Infinity, Incognito, Ticket } from "./icons";
import { Ed25519KeyIdentity } from "@dfinity/identity";
import { II_URL, II_DERIVATION_URL, MAINNET_MODE, CANISTER_ID } from "./env";
import { ApiGenerator } from "./api";

const isSecurePassword = (password: string): boolean =>
    /^(?=.*?[A-Z])(?=.*?[0-9])(?=.*?[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]).{8,}$/.test(
        password,
    ) || !MAINNET_MODE;

export const authMethods = [
    {
        icon: <Ticket />,
        label: "INVITE",
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
    {
        icon: <Incognito />,
        label: "PASSWORD",
        description:
            "This authentication method works on any device and only requires you to memorize one password.",
        login: async (confirmationRequired?: boolean): Promise<JSX.Element> => (
            <SeedPhraseForm
                classNameArg="spaced"
                callback={async (password: string) => {
                    if (!password) return;
                    let seed = await hash(password, HASH_ITERATIONS);
                    let identity = Ed25519KeyIdentity.generate(seed);
                    const result = await migrateIfNeeded(password);
                    if (result) {
                        identity = result;
                    } else if (
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
    window.authClient.logout();
};

export const LoginMasks = ({
    confirmationRequired,
}: {
    confirmationRequired?: boolean;
}) => {
    const [mask, setMask] = React.useState<JSX.Element>();
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
                        onClick={async () => {
                            let mask = await method.login(confirmationRequired);
                            if (mask) setMask(mask);
                        }}
                    >
                        {method.icon} {`${method.label}`}
                    </button>
                    <label className="top_spaced">{method.description}</label>
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

// Migrates users by asking for a new password, hashing it with many iterations
// and then calling a corresponding canister function using the old principal.
const migrateIfNeeded = async (password: string) => {
    const oldSeed = await hash(password, 1);
    const oldId = Ed25519KeyIdentity.generate(oldSeed);
    const oldPrincipal = oldId.getPrincipal().toString();
    if (!(await window.api.query("user", [oldPrincipal])))
        // no user exists, so no migration is needed
        return null;
    if (
        !confirm(
            "Please note that the password login has been significantly improved. " +
                "You are still using the old method, and your account will now be migrated. " +
                "The only noticeable side-effect for you will be that your principal will change. " +
                "Please refrain from using the old principal anymore.",
        )
    )
        return oldId;
    const accountBalance = await window.api.account_balance(ICP_LEDGER_ID, {
        owner: oldId.getPrincipal(),
    });
    if (accountBalance > 0) {
        alert(
            "Your ICP balance is not empty. Please withdraw all funds before migrating.",
        );
        return oldId;
    }
    let newPassword = await popUp<string>(<MigrationPasswordMask />);
    if (!newPassword) return oldId;
    let seed = await hash(newPassword, HASH_ITERATIONS);
    let identity = Ed25519KeyIdentity.generate(seed);
    await ApiGenerator(MAINNET_MODE, CANISTER_ID, oldId).call(
        "migrate",
        identity.getPrincipal().toString(),
    );
    return identity;
};

const MigrationPasswordMask = ({
    popUpCallback,
}: {
    popUpCallback?: (arg: any) => void;
}) => {
    const [password1, setPassword1] = React.useState("");
    const [password2, setPassword2] = React.useState("");
    return (
        <div className="column_container stands_out">
            <p>
                Please specify a new secure password. A secure password should
                contain at least 8 symbols such as uppercase and lowercase
                letters, symbols and digits. Please use the password manager or
                write down your password on paper and store securely. If you
                forget your password, your account will be lost.{" "}
                <strong>There is no password recovery.</strong>
            </p>
            <input
                value={password1}
                onChange={(e) => setPassword1(e.target.value)}
                className="max_width_col"
                type="password"
                placeholder="Enter your password..."
            />
            <input
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
                className="max_width_col top_spaced bottom_spaced"
                type="password"
                placeholder="Repeat your password..."
            />
            <button
                className="max_width_col active fat"
                onClick={() => {
                    if (password1 != password2) alert("Passwords don't match!");
                    else if (popUpCallback) popUpCallback(password1);
                }}
            >
                CONTINUE
            </button>
        </div>
    );
};
