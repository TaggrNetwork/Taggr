import * as React from "react";
import {
    ButtonWithLoading,
    Loading,
    bucket_image_url,
    createChunks,
    getAllTokens,
    getCanistersMetaData,
    getUserCanisterKey,
} from "./common";
import { Principal } from "@dfinity/principal";
import { Icrc1Canister } from "./types";
import { Add, Repost, Trash } from "./icons";
import { TokenSelect } from "./token-select";
import { CANISTER_ID } from "./env";

export const Icrc1TokensWallet = () => {
    const [user] = React.useState(window.user);
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
    const [disabled, setDisabled] = React.useState(true);
    const [dropdownCanisters, setDropdownCanisters] = React.useState<
        Array<[string, Icrc1Canister]>
    >([]);

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
                setCanisterBalances({ ...balances }); // Add to the view
            }
        }
        return balances;
    };

    const loadAllBalances = async () => {
        setDisabled(true);
        try {
            const canisters = await getCanistersMetaData(
                user?.wallet_tokens || [],
            );
            const balances = await loadBalances([...canisters.keys()]);
            setIcrc1Canisters(
                filterAndSortCanisters([...canisters.entries()], balances),
            );
        } finally {
            setDisabled(false);
        }
    };

    const initialLoad = async () => {
        const userCanisters = await getCanistersMetaData(
            user?.wallet_tokens || [],
        );
        setIcrc1Canisters([...userCanisters.entries()]);
        // setDropdownCanisters([...canisters.entries()]);

        const balances = await loadBalances([...userCanisters.keys()]);

        setIcrc1Canisters(
            filterAndSortCanisters([...userCanisters.entries()], balances),
        );

        // Async, don't wait for dropdown
        getAllTokens()
            .then(async (tokens) => {
                const topVolume = tokens
                    .sort((a, b) => b.totalVolumeUSD - a.totalVolumeUSD)
                    .slice(0, 50)
                    .map(({ address }) => address);
                const topLast7DaysVolume = tokens
                    .sort((a, b) => b.volumeUSD7d - a.volumeUSD7d)
                    .slice(0, 50)
                    .map(({ address }) => address);

                const topCanisters = await getCanistersMetaData([
                    ...new Set([
                        ...topLast7DaysVolume,
                        ...topVolume,
                        CANISTER_ID,
                    ]),
                ]);

                const sorted: Array<[string, Icrc1Canister]> = [
                    ...topVolume
                        .filter((canisterId) => topCanisters.has(canisterId))
                        .map(
                            (canisterId) =>
                                [canisterId, topCanisters.get(canisterId)] as [
                                    string,
                                    Icrc1Canister,
                                ],
                        ),
                    ...topLast7DaysVolume
                        .filter((canisterId) => topCanisters.has(canisterId))
                        .map(
                            (canisterId) =>
                                [canisterId, topCanisters.get(canisterId)] as [
                                    string,
                                    Icrc1Canister,
                                ],
                        ),
                    ...userCanisters.entries(),
                ];

                setDropdownCanisters(sorted);
            })
            .catch((e) => {
                // Ignore
                console.error(e);
            });
    };
    let loading = false;
    React.useEffect(() => {
        if (!loading) {
            loading = true;
            initialLoad().finally(() => {
                loading = false;
                setDisabled(false);
            });
        }
    }, []);

    const addIcrc1Canister = async (canisterId?: string) => {
        canisterId = canisterId || prompt(`ICRC-1 canister id:`) || "";
        if (!canisterId) {
            return;
        }
        try {
            setDisabled(true);
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
        } finally {
            setDisabled(false);
        }
    };

    const removeIcrc1CanisterPrompt = async (
        canisterId: string,
        info: Icrc1Canister,
    ) => {
        if (!canisterId) {
            return;
        }
        const proceed = confirm(`Remove ${info.symbol} ?`);
        if (!proceed) {
            return;
        }
        try {
            setDisabled(true);
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
        } finally {
            setDisabled(false);
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
            if (u64Amount < 1) {
                return alert("Amount is too small!");
            }
            const decimalPart = (amount % 1).toPrecision(15); // Max 64bit precision
            if (
                decimalPart.toString().replaceAll("0", "").replace(".", "")
                    .length > info.decimals
            ) {
                return alert(`More than ${info.decimals} decimals!`);
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
                        disabled={disabled}
                        onChange={async () => {
                            const canisters = [
                                ...(await getCanistersMetaData(
                                    user?.wallet_tokens || [],
                                )),
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
                {dropdownCanisters.length > 0 && (
                    <TokenSelect
                        canisters={dropdownCanisters}
                        onSelectionChange={async (canisterId) => {
                            await addIcrc1Canister(canisterId);
                        }}
                    />
                )}
                <ButtonWithLoading
                    onClick={addIcrc1Canister}
                    label={<Add />}
                    title="Add token"
                    disabled={disabled}
                ></ButtonWithLoading>
                <ButtonWithLoading
                    title="Refresh balances"
                    onClick={loadAllBalances}
                    label={<Repost />}
                    disabled={disabled}
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
                                disabled={disabled}
                                onClick={() =>
                                    removeIcrc1CanisterPrompt(canisterId, info)
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
