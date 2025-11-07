import * as React from "react";
import {
    ButtonWithLoading,
    Loading,
    cacheLocalStorage,
    createChunks,
    getCanistersMetaData,
    getLocalCanistersMetaData,
    getUserCanisterKey,
    getUserTokens,
    icpSwapLogoFallback,
    icrcTransfer,
    showPopUp,
} from "./common";
import { Principal } from "@dfinity/principal";
import { Icrc1Canister } from "./types";
import { Add, Repost, Trash } from "./icons";

export const Icrc1TokensWallet = () => {
    const user = window.user;
    const userWalletFiltersKey = `user:${user?.id}:wallet-filters`;

    const [tokens, setTokens] = React.useState<Array<[string, Icrc1Canister]>>(
        [],
    );
    const [canisterBalances, setCanisterBalances] = React.useState<{
        [key: string]: string | number;
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

    /** Load balances of user canisters in small batches to avoid spikes */
    const loadBalances = async (canisterIds: string[]) => {
        const balances: { [key: string]: string | number } = {
            ...canisterBalances,
        };
        const chunks = createChunks(canisterIds, 5);

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

        return balances;
    };

    const loadAllBalances = async () => {
        setDisabled(true);
        try {
            const canisters = await getCanistersMetaData(
                user?.wallet_tokens || [],
            );
            const balances = await loadBalances([...canisters.keys()]);
            setTokens(
                filterTokens(
                    [...canisters.entries()],
                    balances,
                    hideZeroBalance,
                ),
            );
        } finally {
            setDisabled(false);
        }
    };

    const initialLoad = async () => {
        const currentUserTokens = new Set(user?.wallet_tokens || []);
        const initialTokensData = await getCanistersMetaData([
            ...currentUserTokens,
        ]);
        setTokens(
            filterTokens([...initialTokensData.entries()], {}, hideZeroBalance),
        );
        void loadBalances([...currentUserTokens]);

        // Automatic token discovery
        const discoveredTokens = await getUserTokens(user);
        const discoveredCanisterIds = new Set(
            discoveredTokens.map(({ canisterId }) => canisterId),
        );

        // Merge current and discovered tokens (Set automatically deduplicates)
        const allUserTokens = new Set([
            ...currentUserTokens,
            ...discoveredCanisterIds,
        ]);

        const allUserTokensData = await getCanistersMetaData([
            ...allUserTokens,
        ]);
        setTokens(
            filterTokens([...allUserTokensData.entries()], {}, hideZeroBalance),
        );

        const balances = await loadBalances([...allUserTokens]);

        setTokens(
            filterTokens(
                [...allUserTokensData.entries()],
                balances,
                hideZeroBalance,
            ),
        );

        // Only update if new tokens were discovered
        if (allUserTokens.size !== currentUserTokens.size) {
            user.wallet_tokens = [...allUserTokens];
            window.api.call<any>("update_wallet_tokens", user.wallet_tokens);
        }
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
        canisterId = canisterId || prompt(`ICRC canister id:`) || "";
        if (!canisterId) return;
        try {
            setDisabled(true);
            Principal.fromText(canisterId);

            if (user?.wallet_tokens?.includes(canisterId)) {
                const canisterMeta =
                    getLocalCanistersMetaData([canisterId])?.at(0) || [];
                return showPopUp(
                    "info",
                    `Token ${canisterMeta[1]?.symbol || canisterId} was already added`,
                    4,
                );
            }

            const meta = await window.api.icrc_metadata(canisterId);
            if (!meta)
                throw new Error("Could not find ICRC-1 canister metadata");

            // Set global user, avoid callbacks
            user.wallet_tokens = [...(user?.wallet_tokens || []), canisterId];
            const response = await window.api.call<any>(
                "update_wallet_tokens",
                user.wallet_tokens,
            );
            if (response?.Err) return showPopUp("error", response.Err);

            cacheLocalStorage(getUserCanisterKey(canisterId), meta);
            const balances = await loadBalances([canisterId]);

            setTokens(
                filterTokens(
                    [...tokens, [canisterId, meta]],
                    balances,
                    hideZeroBalance,
                ),
            );
        } catch (error: any) {
            showPopUp(
                "error",
                error?.message || "Failed to add token to your wallet",
            );
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
                return showPopUp(
                    "info",
                    `Token ${canisterId} is not in your list`,
                );
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
                return showPopUp("error", response.Err);
            }

            localStorage.removeItem(getUserCanisterKey(canisterId));

            setTokens(tokens.filter(([id]) => id !== canisterId));
        } catch (error: any) {
            showPopUp(
                "error",
                error?.message || "Failed to add token to your wallet",
            );
        } finally {
            setDisabled(false);
        }
    };

    return (
        <>
            <div
                className="vcentered bottom_spaced"
                data-testid="ic-tokens-div"
            >
                <h2 className="max_width_col">ICRC TOKENS</h2>
                <div className="vcentered">
                    <input
                        id="canisters-hide-zero-balance"
                        data-testid="canisters-hide-zero-balance"
                        type="checkbox"
                        checked={hideZeroBalance}
                        disabled={disabled}
                        onChange={async () => {
                            const canisters = [
                                ...(await getCanistersMetaData(
                                    user?.wallet_tokens || [],
                                )),
                            ];
                            const filteredCanisters = filterTokens(
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
                            setTokens(filteredCanisters);
                        }}
                    />
                    <label
                        className="left_half_spaced right_spaced"
                        htmlFor="canisters-hide-zero-balance"
                    >
                        Hide zeros
                    </label>
                </div>
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
            {tokens.length > 0 && (
                <div className="column_container">
                    {tokens.map(([canisterId, info]) => (
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
                                    info.logo || icpSwapLogoFallback(canisterId)
                                }
                            />
                            <span className="left_half_spaced monospace">
                                {info.symbol}
                            </span>
                            <div className="max_width_col"></div>
                            <code
                                className="right_spaced"
                                data-testid={canisterId + "-balance"}
                            >
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
                                testId={canisterId + "-send"}
                                onClick={async () => {
                                    const response = await icrcTransfer(
                                        Principal.fromText(canisterId),
                                        info.symbol,
                                        info.decimals,
                                        info.fee,
                                    );
                                    if (isNaN(+(response || ""))) {
                                        return showPopUp(
                                            "error",
                                            JSON.stringify(response),
                                        );
                                    }
                                    await loadBalances([canisterId]); // Refresh balance
                                }}
                                label={"SEND"}
                            ></ButtonWithLoading>
                            <ButtonWithLoading
                                testId={canisterId + "-remove"}
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

const filterTokens = (
    canisters: Array<[string, Icrc1Canister]>,
    balances: Record<string, string | number>,
    hideZeroBalance: boolean,
) => {
    let filteredCanisters = canisters;
    if (hideZeroBalance) {
        filteredCanisters = canisters.filter(
            ([canisterId]) => +balances[canisterId] > 0,
        );
    }
    return filteredCanisters.sort((a, b) =>
        a[1].symbol.localeCompare(b[1].symbol),
    );
};
