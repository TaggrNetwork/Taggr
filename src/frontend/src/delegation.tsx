import { Principal } from "@dfinity/principal";
import {
    ButtonWithLoading,
    NotAllowed,
    onCanonicalDomain,
    showPopUp,
    signOut,
    domain as getDomain,
} from "./common";

export const DELEGATION_DOMAIN = "delegation_domain";
export const DELEGATION_PRINCIPAL = "DELEGATION_PRINCIPAL";

export const Delegate = ({}: {}) => {
    if (!onCanonicalDomain()) return <NotAllowed where={getDomain()} />;

    const domain = localStorage.getItem(DELEGATION_DOMAIN);
    const principal = localStorage.getItem(DELEGATION_PRINCIPAL);

    return (
        <div className="stands_out centered larger_text column_container">
            <p>
                Hello {window.user.name}, you are signing into{" "}
                {window.backendCache.config.name} from the custom domain{" "}
                <b>{domain}</b>.
            </p>
            <div className="row_container">
                <button
                    className="medium_text max_width_col right_half_spaced"
                    onClick={signOut}
                >
                    SIGN OUT
                </button>
                <ButtonWithLoading
                    classNameArg="active max_width_col left_half_spaced"
                    label="AUTHORIZE"
                    onClick={async () => {
                        localStorage.removeItem(DELEGATION_DOMAIN);
                        localStorage.removeItem(DELEGATION_PRINCIPAL);

                        const response = await window.api.call<any>(
                            "set_delegation",
                            domain,
                            principal,
                        );
                        if (response && "Err" in response) {
                            showPopUp("error", response.Err);
                            return;
                        }

                        // Authorize the delegate in the user's media bucket so
                        // image uploads work from the custom domain. This runs
                        // here on the canonical domain, where the signer is a
                        // bucket controller. Non-fatal: text posts work without
                        // it, so a failure must not block sign-in.
                        if (window.user?.bucket && principal) {
                            try {
                                await window.api.bucket_add_session(
                                    Principal.fromText(window.user.bucket),
                                    Principal.fromText(principal),
                                );
                            } catch (e) {
                                console.error(e);
                            }
                        }

                        location.href = `https://${domain}`;
                    }}
                />
            </div>
        </div>
    );
};
