import * as React from "react";
import { ICP_LEDGER_ID } from "./common";
import { Icrc1Canister } from "./types";
import { CANISTER_ID } from "./env";

export const TokenSelect = ({
    classNameArg,
    canisters,
    onSelectionChange,
    selectedCanisterId,
}: {
    classNameArg?: string;
    canisters: Record<string, Icrc1Canister>;
    onSelectionChange: (canisterId: string) => void;
    selectedCanisterId?: string;
}) => {
    // State to store selected values
    const [selectedValue, setSelectedValue] = React.useState<string>(
        selectedCanisterId || "",
    );
    const [defaultCanisters, setDefaultCanisters] = React.useState<
        Array<[string, Icrc1Canister]>
    >([]);
    const [mainCanisters, setMainCanisters] = React.useState<
        Array<[string, Icrc1Canister]>
    >([]);
    const [userCanisters, setUserCanisters] = React.useState<
        Array<[string, Icrc1Canister]>
    >([]);

    // Handle change when options are selected/deselected
    const handleChange = (event: any) => {
        const value = (event.target as any).value || CANISTER_ID;
        setSelectedValue(value);
        onSelectionChange(value);
    };

    const setData = () => {
        // Add ICP or Taggr
        const mainCanisters: Array<[string, Icrc1Canister]> = [];
        const nativeCanister = canisters[CANISTER_ID];
        if (nativeCanister) {
            mainCanisters.push([CANISTER_ID, nativeCanister]);
        }

        const icpCanister = canisters[ICP_LEDGER_ID.toText()];
        if (icpCanister) {
            mainCanisters.push([ICP_LEDGER_ID.toText(), icpCanister]);
        }

        setMainCanisters(mainCanisters);

        setDefaultCanisters(
            Object.keys(canisters)
                .filter(
                    (canisterId) =>
                        ![CANISTER_ID, ICP_LEDGER_ID.toText()].includes(
                            canisterId,
                        ),
                )
                .map((canisterId) => [canisterId, canisters[canisterId]]),
        );

        const userTokens = window.user?.wallet_tokens || [];
        setUserCanisters(
            Object.keys(canisters)
                .filter((canisterId) => userTokens.includes(canisterId))
                .map((canisterId) => [canisterId, canisters[canisterId]]),
        );
    };

    let initial = false;
    React.useEffect(() => {
        if (!initial) {
            initial = true;
            setData();
            initial = false;
        }
        if (selectedCanisterId) {
            setSelectedValue(selectedCanisterId);
        }
    }, [selectedCanisterId]);

    return (
        <select
            className={classNameArg}
            value={selectedValue}
            onChange={handleChange}
            style={{ fontSize: "small" }}
        >
            <option key={"main-option"} value={""}>
                {""}
            </option>
            {mainCanisters.length > 0 && (
                <optgroup label="Main">
                    {mainCanisters.map(([canisterId, canisterMeta]) => (
                        <option
                            key={"main-option-" + canisterId}
                            value={canisterId}
                        >
                            {canisterMeta.symbol}
                        </option>
                    ))}
                </optgroup>
            )}
            {userCanisters.length > 0 && (
                <optgroup label="Your Tokens">
                    {userCanisters.map(([canisterId, canisterMeta]) => (
                        <option
                            key={"user-tokens-option-" + canisterId}
                            value={canisterId}
                        >
                            {canisterMeta.symbol}
                        </option>
                    ))}
                </optgroup>
            )}
            {defaultCanisters.length > 0 && (
                <optgroup label="Tokens">
                    {defaultCanisters.map(([canisterId, canisterMeta]) => (
                        <option
                            key={"tokens-option-" + canisterId}
                            value={canisterId}
                        >
                            {canisterMeta.symbol}
                        </option>
                    ))}
                </optgroup>
            )}
        </select>
    );
};
