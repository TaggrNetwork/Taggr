import * as React from "react";
import { ICP_LEDGER } from "./common";
import { Icrc1Canister } from "./types";
import { CANISTER_ID } from "./env";

export const TokenSelect = ({
    classNameArg,
    canisters,
    onSelectionChange,
    selectedCanisterId,
}: {
    classNameArg?: string;
    canisters: Array<[string, Icrc1Canister]>;
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
        const canistersMap = new Map(canisters);
        // Add ICP or Taggr
        const mainCanisters: Array<[string, Icrc1Canister]> = [];
        const nativeCanister = canistersMap.get(CANISTER_ID);
        if (nativeCanister) {
            mainCanisters.push([CANISTER_ID, nativeCanister]);
        }

        const icpCanister = canistersMap.get(ICP_LEDGER);
        if (icpCanister) {
            mainCanisters.push([ICP_LEDGER, icpCanister]);
        }

        setMainCanisters(mainCanisters);

        setDefaultCanisters(
            canisters.filter(
                ([canisterId]) =>
                    ![CANISTER_ID, ICP_LEDGER].includes(canisterId),
            ),
        );

        const userTokens = window.user?.wallet_tokens || [];
        setUserCanisters(
            userTokens
                .filter((id) => canistersMap.has(id))
                .map((canisterId) => [
                    canisterId,
                    canistersMap.get(canisterId) as Icrc1Canister,
                ]),
        );
    };

    React.useEffect(() => {
        setData();
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
            {!selectedCanisterId && (
                <option key={"main-option"} value={""}>
                    {""}
                </option>
            )}
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
