import * as React from "react";
import { ICP_LEDGER } from "./common";
import { Icrc1Canister } from "./types";
import { CANISTER_ID } from "./env";

export const TokenSelect = ({
    classNameArg,
    canisters,
    disabled = false,
    onSelectionChange,
    selectedCanisterId,
}: {
    classNameArg?: string;
    canisters: Array<[string, Icrc1Canister]>;
    disabled?: boolean;
    onSelectionChange: (canisterId: string) => void;
    selectedCanisterId?: string;
}) => {
    // State to store selected values
    const [selectedValue, setSelectedValue] = React.useState<string>(
        selectedCanisterId || "",
    );
    const [userTokens, setUserTokens] = React.useState<
        Array<[string, Icrc1Canister]>
    >([]);

    // Handle change when options are selected/deselected
    const handleChange = (event: any) => {
        const value = (event.target as any).value || CANISTER_ID;
        setSelectedValue(value);
        onSelectionChange(value);
    };

    const loadData = () => {
        const canistersMap = new Map(canisters);
        // Add ICP or Taggr
        const mainTokens: Array<[string, Icrc1Canister]> = [];
        const nativeCanister = canistersMap.get(CANISTER_ID);
        if (nativeCanister) {
            mainTokens.push([CANISTER_ID, nativeCanister]);
        }

        const icpCanister = canistersMap.get(ICP_LEDGER);
        if (icpCanister) {
            mainTokens.push([ICP_LEDGER, icpCanister]);
        }

        const userTokens = window.user?.wallet_tokens || [];
        setUserTokens(
            userTokens
                .filter((id) => canistersMap.has(id))
                .map((canisterId) => [
                    canisterId,
                    canistersMap.get(canisterId) as Icrc1Canister,
                ]),
        );
    };

    React.useEffect(() => {
        loadData();
        if (selectedCanisterId) {
            setSelectedValue(selectedCanisterId);
        }
    }, [selectedCanisterId, canisters.map(([id]) => id).toString(), disabled]);

    const renderOptions = (
        canisters: Array<[string, Icrc1Canister]>,
        label: string,
    ) => {
        return (
            <optgroup label={label}>
                {canisters.map(([canisterId, canisterMeta]) => (
                    <option key={canisterId} value={canisterId}>
                        {canisterMeta.symbol}
                    </option>
                ))}
            </optgroup>
        );
    };

    return (
        <select
            data-testid="icrc-wallet-token-selector"
            className={classNameArg}
            disabled={disabled}
            value={selectedValue}
            onChange={handleChange}
            style={{ fontSize: "small" }}
        >
            {!selectedCanisterId && (
                <option key={"main-option"} value={""}>
                    SELECT TOKEN
                </option>
            )}
            {userTokens.length > 0 &&
                renderOptions(userTokens, "Tipping Tokens")}
        </select>
    );
};
