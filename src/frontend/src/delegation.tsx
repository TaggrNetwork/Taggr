import { LoginMasks } from "./authentication";
import {
    ButtonWithLoading,
    domain,
    NotAllowed,
    popUp,
    showPopUp,
    signOut,
} from "./common";
import { MAINNET_MODE } from "./env";

export const Delegate = ({
    domain,
    principal,
}: {
    domain: string;
    principal: string;
}) => {
    if (!window.principalId) {
        popUp(<LoginMasks />);
        return null;
    }

    if (!onCanonicalDomain()) return <NotAllowed />;

    return (
        <div className="stands_out centered larger_text column_container">
            <p>
                Hello {window.user.name}, you are signin into{" "}
                {window.backendCache.config.name} from the custom domain{" "}
                <b>{domain}</b>.
            </p>
            <ButtonWithLoading
                classNameArg="vertically_spaced active"
                label="AUTHORIZE"
                onClick={async () => {
                    const response = await window.api.call<any>(
                        "set_delegation",
                        principal,
                    );
                    if (response && "Err" in response) {
                        showPopUp("error", response.Err);
                        return;
                    }

                    location.href = `https://${domain}`;
                }}
            />
            <button onClick={signOut}>SIGN OUT</button>
        </div>
    );
};

export const getCanonicalDomain = () =>
    `${window.backendCache.stats.canister_id}.icp0.io`;

export const onCanonicalDomain = () =>
    !MAINNET_MODE || domain() == getCanonicalDomain();
