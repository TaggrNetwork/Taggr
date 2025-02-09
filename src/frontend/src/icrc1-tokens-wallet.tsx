import * as React from "react";
import {
    ButtonWithLoading,
    Loading,
    bucket_image_url,
    createChunks,
} from "./common";
import { Principal } from "@dfinity/principal";
import { Icrc1Canister } from "./types";
import { Add, Repost, Trash } from "./icons";

export const Icrc1TokensWallet = () => {
    const [user] = React.useState(window.user);
    const getUserCanisterKey = (canisterId: string) =>
        `canister:${canisterId}:user:${user?.id}`;
    const userWalletFiltersKey = `user:${user?.id}:wallet-filters`;
    const [icrc1Canisters, setIcrc1Canisters] = React.useState<
        Array<[string, Icrc1Canister]>
    >([]);
    const [canisterBalances, setCanisterBalances] = React.useState<{
        [key: string]: string;
    }>({});
    const getLocalFilters = (): { hideZeroBalance?: boolean } => {
        const filters = localStorage.getItem(userWalletFiltersKey);
        try {
            return JSON.parse(filters || "");
        } catch {
            return {};
        }
    };
    const [hideZeroBalance, setHideZeroBalance] = React.useState(
        getLocalFilters()?.hideZeroBalance || false,
    );

    const filterAndSortCanisters = (
        canisters: Array<[string, Icrc1Canister]>,
        balances: Record<string, string>,
        _hideZeroBalance = hideZeroBalance,
    ) => {
        let filteredCanisters = canisters;
        if (_hideZeroBalance) {
            filteredCanisters = canisters.filter(
                ([canisterId]) => +balances[canisterId] > 0,
            );
        }
        // Sort by name and then balance
        return filteredCanisters
            .sort((a, b) => a[1].symbol.localeCompare(b[1].symbol))
            .sort(
                (a, b) =>
                    +balances[b[0]] / Math.pow(10, b[1].decimals) -
                    +balances[a[0]] / Math.pow(10, a[1].decimals),
            );
    };

    const getLocalCanistersMetaData = (): Array<[string, Icrc1Canister]> => {
        return (user?.wallet_tokens || [])
            .map((canisterId) => {
                try {
                    const canisterMeta: Icrc1Canister | null = JSON.parse(
                        localStorage.getItem(
                            getUserCanisterKey(canisterId),
                        ) as string,
                    );
                    if (
                        !canisterMeta?.symbol ||
                        !canisterMeta?.name ||
                        isNaN(canisterMeta?.decimals) ||
                        isNaN(canisterMeta?.fee)
                    ) {
                        return null;
                    }
                    return [canisterId, canisterMeta] as [
                        string,
                        Icrc1Canister,
                    ];
                } catch {
                    return null;
                }
            })
            .filter((r) => !!r)
            .sort((a, b) => a[1].symbol.localeCompare(b[1].symbol));
    };

    const getCanistersMetaData = async () => {
        // Add missing user canisters key for metadata
        const canistersFromStorageMap = new Map<string, Icrc1Canister>(
            getLocalCanistersMetaData(),
        );

        // Add missing user canisters key for metadata
        const missingMetaCanisterIds =
            user.wallet_tokens?.filter(
                (canisterId) => !canistersFromStorageMap.has(canisterId),
            ) || [];

        if (missingMetaCanisterIds.length === 0) {
            return canistersFromStorageMap;
        }

        const chunks = createChunks(missingMetaCanisterIds, 5);
        // Load missing metadata
        for (const chunk of chunks) {
            await Promise.all(
                chunk.map((canisterId) =>
                    window.api
                        .icrc_metadata(canisterId)
                        .then((meta) => {
                            if (meta) {
                                canistersFromStorageMap.set(canisterId, meta);
                                localStorage.setItem(
                                    getUserCanisterKey(canisterId),
                                    JSON.stringify(meta),
                                );
                            }
                        })
                        .catch(console.error),
                ),
            );
        }

        return canistersFromStorageMap;
    };

    /** Load balances of user canisters in small batches to avoid spikes */
    const loadBalances = async (canisterIds: string[]) => {
        const balances: { [key: string]: string } = { ...canisterBalances };
        const chunks = createChunks(canisterIds, 5);

        if (user) {
            for (const chunk of chunks) {
                await Promise.all(
                    chunk.map((canisterId) =>
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
                if (chunks.length !== 1 && chunks.at(-1) !== chunk) {
                    setCanisterBalances({ ...balances }); // Add to the view
                }
            }
        }
        setCanisterBalances(balances);
        return balances;
    };

    const loadAllBalances = async () => {
        const canisters = await getCanistersMetaData();
        const balances = await loadBalances([...canisters.keys()]);
        setIcrc1Canisters(
            filterAndSortCanisters([...canisters.entries()], balances),
        );
    };

    const initialLoad = async () => {
        const canisters = await getCanistersMetaData();
        setIcrc1Canisters([...canisters.entries()]);

        const balances = await loadBalances([...canisters.keys()]);

        setIcrc1Canisters(
            filterAndSortCanisters([...canisters.entries()], balances),
        );
    };
    let loading = false;
    React.useEffect(() => {
        if (!loading) {
            loading = true;
            initialLoad().finally(() => (loading = false));
        }
    }, []);

    const addIcrc1CanisterPrompt = async () => {
        const canisterId = prompt(`ICRC-1 canister id:`) || "";
        if (!canisterId) {
            return;
        }
        try {
            Principal.fromText(canisterId);

            if (user?.wallet_tokens?.includes(canisterId)) {
                const canisterMeta = JSON.parse(
                    localStorage.getItem(getUserCanisterKey(canisterId)) || "",
                );
                return alert(
                    `Token ${canisterMeta?.symbol || canisterId} was already added`,
                );
            }

            const meta = await window.api.icrc_metadata(canisterId);
            if (!meta) {
                throw new Error("Could not find ICRC-1 canister metadata");
            }

            // Set global user, avoid callbacks
            user.wallet_tokens = [...(user?.wallet_tokens || []), canisterId];
            const response = await window.api.call<any>(
                "update_wallet_tokens",
                user.wallet_tokens,
            );
            if (response?.Err) {
                return alert(response.Err);
            }

            localStorage.setItem(
                getUserCanisterKey(canisterId),
                JSON.stringify(meta),
            );
            const balances = await loadBalances([canisterId]);

            setIcrc1Canisters(
                filterAndSortCanisters(
                    [...icrc1Canisters, [canisterId, meta]],
                    balances,
                ),
            );
        } catch (error: any) {
            alert(error?.message || "Failed to add token to your wallet");
        }
    };

    const removeIcrc1CanisterPrompt = async (canisterId: string) => {
        if (!canisterId) {
            return;
        }
        try {
            Principal.fromText(canisterId);

            if (!user?.wallet_tokens?.includes(canisterId)) {
                return alert(`Token ${canisterId} is not in your list`);
            }

            // Set global user, avoid callbacks
            user.wallet_tokens = user.wallet_tokens.filter(
                (id) => id !== canisterId,
            );
            const response = await window.api.call<any>(
                "update_wallet_tokens",
                user.wallet_tokens,
            );
            if (response?.Err) {
                return alert(response.Err);
            }

            localStorage.removeItem(getUserCanisterKey(canisterId));

            setIcrc1Canisters(
                icrc1Canisters.filter(([id]) => id !== canisterId),
            );
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

            const amount: number = +(
                prompt(
                    `Amount ${info.symbol} to send, (fee: ${(info.fee / Math.pow(10, info.decimals)).toString()})`,
                    (0).toFixed(info.decimals),
                ) || 0
            );
            const u64Amount = Math.floor(amount * Math.pow(10, info.decimals));
            if (u64Amount <= info.fee) {
                return alert("Amount is smaller than fee!");
            }

            if (toPrincipal && amount) {
                const proceed = confirm(
                    `Transfer ${amount} ${info.symbol} to ${toPrincipal}?`,
                );
                if (!proceed) {
                    return;
                }

                const amountOrError = await window.api.icrc_transfer(
                    Principal.fromText(canisterId),
                    toPrincipal,
                    u64Amount,
                    info.fee,
                );
                if (isNaN(+amountOrError)) {
                    return alert(amountOrError);
                }

                await loadBalances([canisterId]);
            }
        } catch (e: any) {
            alert(e.message);
        }
    };

    return (
        <>
            <div className="vcentered bottom_spaced">
                <h2 className="max_width_col">IC TOKENS</h2>
                <div className="vcentered">
                    <input
                        id="canisters-hide-zero-balance"
                        type="checkbox"
                        checked={hideZeroBalance}
                        onChange={async () => {
                            const canisters = [
                                ...(await getCanistersMetaData()),
                            ];
                            const filteredCanisters = filterAndSortCanisters(
                                canisters,
                                canisterBalances,
                                !hideZeroBalance,
                            );
                            const filters = getLocalFilters();
                            filters.hideZeroBalance = !hideZeroBalance;
                            localStorage.setItem(
                                userWalletFiltersKey,
                                JSON.stringify(filters),
                            );
                            setHideZeroBalance(!hideZeroBalance);
                            setIcrc1Canisters(filteredCanisters);
                        }}
                    />
                    <label
                        className="right_half_spaced"
                        htmlFor="canisters-hide-zero-balance"
                    >
                        Hide empty balances
                    </label>
                </div>
                <ButtonWithLoading
                    onClick={addIcrc1CanisterPrompt}
                    label={<Add />}
                    title="Add token"
                ></ButtonWithLoading>
                <ButtonWithLoading
                    title="Refresh balances"
                    onClick={loadAllBalances}
                    label={<Repost />}
                ></ButtonWithLoading>
            </div>
            {icrc1Canisters.length > 0 && (
                <div className="column_container">
                    {icrc1Canisters.map(([canisterId, info]) => (
                        <div
                            className="vcentered bottom_spaced"
                            key={canisterId}
                        >
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
                                {isNaN(Number(canisterBalances[canisterId])) ? (
                                    <Loading spaced={false} />
                                ) : (
                                    (
                                        Number(canisterBalances[canisterId]) /
                                        Math.pow(10, info.decimals)
                                    )?.toFixed(info.decimals)
                                )}
                            </code>
                            <ButtonWithLoading
                                classNameArg="send"
                                onClick={() =>
                                    icrcTransferPrompts(canisterId, info)
                                }
                                label={"Send"}
                            ></ButtonWithLoading>
                            <ButtonWithLoading
                                onClick={() =>
                                    removeIcrc1CanisterPrompt(canisterId)
                                }
                                label={<Trash />}
                                title="Remove token"
                            ></ButtonWithLoading>
                        </div>
                    ))}
                </div>
            )}
        </>
    );
};
