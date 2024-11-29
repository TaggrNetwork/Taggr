import * as React from "react";
import { ButtonWithLoading } from "./common";
import { authMethods } from "./authentication";
import { SignWithEthereum } from "./siwe";

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
        <div className="vertically_spaced text_centered column_container">
            <SignWithEthereum />
            {methods.map((method) => (
                <ButtonWithLoading
                    key={method.label}
                    classNameArg="large_text left_spaced right_spaced bottom_spaced"
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
            ))}
        </div>
    );
};
