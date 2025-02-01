import * as React from "react";
import { ButtonWithLoading, bucket_image_url } from "./common";
import { Principal } from "@dfinity/principal";
import { Icrc1Canister } from "./types";
import { Add, Repost } from "./icons";

export const Icrc1TokensWallet = () => {
    const [user] = React.useState(window.user);
    const USER_CANISTERS_KEY = `user:${user?.id}_canisters`;
    const [icrc1Canisters, setIcrc1Canisters] = React.useState<
        Array<[string, Icrc1Canister]>
    >([]);
    const [canisterBalances, setCanisterBalances] = React.useState<{
        [key: string]: string;
    }>({});

    const getCanistersMetaData = async () => {
        const canistersFromStorageMap = new Map<string, Icrc1Canister>(
            (JSON.parse(
                localStorage.getItem(USER_CANISTERS_KEY) || (null as any),
            ) as unknown as Array<[string, Icrc1Canister]>) || [],
        );

        // Add missing user canisters key for metadata
        const missingMetaCanisterIds =
            user.wallet_tokens?.filter(
                (canisterId) => !canistersFromStorageMap.has(canisterId),
            ) || [];

        if (missingMetaCanisterIds.length === 0) {
            return canistersFromStorageMap;
        }

        // Load missing metadata
        await Promise.all(
            missingMetaCanisterIds.map(
                (canisterId) => () =>
                    window.api
                        .icrc_metadata(canisterId)
                        .then((meta) => {
                            if (meta) {
                                canistersFromStorageMap.set(canisterId, meta);
                            }
                        })
                        .catch(console.error),
            ),
        );

        localStorage.setItem(
            USER_CANISTERS_KEY,
            JSON.stringify([...canistersFromStorageMap.entries()]),
        );

        return canistersFromStorageMap;
    };

    const loadIcrc1Canisters = async () => {
        const canisters = await getCanistersMetaData();
        setIcrc1Canisters([...canisters.entries()]);

        loadIcrc1CanisterBalances();
    };

    const loadIcrc1CanisterBalances = async (forCanisterId?: string) => {
        const balances: { [key: string]: string } = { ...canisterBalances };

        const canisters = await getCanistersMetaData();
        if (user) {
            await Promise.all(
                [...canisters.keys()]
                    .filter(
                        (canisterId) =>
                            !forCanisterId || forCanisterId === canisterId,
                    )
                    .map((canisterId) =>
                        window.api
                            .account_balance(Principal.from(canisterId), {
                                owner: Principal.from(user.principal),
                            })
                            .then(
                                (balance) =>
                                    (balances[canisterId] =
                                        new Number(balance).toString() || "0"),
                            )
                            .catch((error) => {
                                console.error(error);
                                balances[canisterId] = "NaN";
                            }),
                    ),
            );
        }
        setCanisterBalances(balances);
    };

    let loading = false;
    React.useEffect(() => {
        if (!loading) {
            loading = true;
            loadIcrc1Canisters().finally(() => (loading = false));
        }
    }, []);

    const addIcrc1CanisterPrompt = async () => {
        const canisterId = prompt(`Icrc1 canister id`) || "";
        if (!canisterId) {
            return;
        }
        try {
            Principal.fromText(canisterId);

            const canisters = await getCanistersMetaData();
            const existingCanister = canisters.get(canisterId);
            if (existingCanister) {
                return alert(
                    `Token ${existingCanister.symbol} was already added`,
                );
            }

            const meta = await window.api.icrc_metadata(canisterId);
            if (!meta) {
                throw new Error("Could not find Icrc1 canister data");
            }

            canisters.set(canisterId, meta);

            const response = await window.api.call<any>(
                "update_wallet_tokens",
                [...canisters.keys()],
            );
            if (response?.Err) {
                return alert(response.Err);
            }

            const entries = [...canisters.entries()];

            localStorage.setItem(USER_CANISTERS_KEY, JSON.stringify(entries));

            setIcrc1Canisters(entries);

            await loadIcrc1CanisterBalances(canisterId);
        } catch (error: any) {
            alert(error?.message || "Failed to add token to your wallet");
        }
    };

    const icrcTransferPrompts = async (
        canisterId: string,
        info: Icrc1Canister,
    ) => {
        try {
            const toPrincipal = Principal.fromText(
                prompt(`Principal to send ${info.symbol}`) || "",
            );
            if (!toPrincipal) {
                return;
            }

            const amount: number =
                +(prompt(`Amount ${info.symbol} to send`) as any) || 0;

            if (toPrincipal && amount) {
                await window.api.icrc_transfer(
                    Principal.fromText(canisterId),
                    toPrincipal,
                    amount as number,
                    info.fee,
                );
                await loadIcrc1CanisterBalances(canisterId);
            }
        } catch (e: any) {
            alert(e.message);
        }
    };

    return (
        <>
            <div className="vcentered bottom_spaced">
                <h2 className="max_width_col">ICRC1 TOKENS</h2>
                <ButtonWithLoading
                    onClick={addIcrc1CanisterPrompt}
                    label={<Add />}
                ></ButtonWithLoading>
                <ButtonWithLoading
                    title="Refresh balances"
                    onClick={loadIcrc1CanisterBalances}
                    label={<Repost />}
                ></ButtonWithLoading>
            </div>
            {icrc1Canisters.length > 0 && (
                <div className="column_container">
                    {icrc1Canisters.map(([canisterId, info]) => (
                        <div className="vcentered" key={canisterId}>
                            <img
                                style={{
                                    height: 32,
                                    width: 32,
                                    verticalAlign: "middle",
                                }}
                                src={
                                    info.logo_params
                                        ? bucket_image_url(...info.logo_params)
                                        : info.logo
                                }
                            />
                            <span className="left_half_spaced monospace">
                                {info.symbol}
                            </span>
                            <div className="max_width_col"></div>
                            <code className="right_spaced">
                                {(
                                    Number(canisterBalances[canisterId]) /
                                    Math.pow(10, info.decimals)
                                )?.toFixed(info.decimals)}
                            </code>
                            <ButtonWithLoading
                                classNameArg="send"
                                onClick={() =>
                                    icrcTransferPrompts(canisterId, info)
                                }
                                label={"Send"}
                            ></ButtonWithLoading>
                        </div>
                    ))}
                </div>
            )}
        </>
    );
};
