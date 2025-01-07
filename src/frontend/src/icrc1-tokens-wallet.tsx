import * as React from "react";
import { ButtonWithLoading, CopyToClipboard } from "./common";
import { Principal } from "@dfinity/principal";
import { Icrc1Canister } from "./types";
import { bucket_image_url } from "./util";
import { Repost } from "./icons";

export const Icrc1TokensWallet = () => {
    const [user] = React.useState(window.user);
    const USER_CANISTERS_KEY = `user:${user?.id}_canisters`;
    const USER_BALANCES_KEY = `user:${user?.id}_canister_balances`;
    const [icrc1Canisters, setIcrc1Canisters] = React.useState<
        Array<[string, Icrc1Canister]>
    >([]);
    const [canisterBalances, setCanisterBalances] = React.useState<{
        [key: string]: string;
    }>({});

    const getCanistersLocal = () => {
        return (
            (JSON.parse(
                localStorage.getItem(USER_CANISTERS_KEY) || (null as any),
            ) as unknown as Array<[string, Icrc1Canister]>) || []
        );
    };

    const getBalancesLocal = () => {
        return (
            (JSON.parse(
                localStorage.getItem(USER_BALANCES_KEY) || (null as any),
            ) as unknown as { [key: string]: string }) || {}
        );
    };

    const loadIcrc1Canisters = async () => {
        const canisters = getCanistersLocal();
        setIcrc1Canisters(canisters);

        loadIcrc1CanisterBalances();
    };

    const loadIcrc1CanisterBalances = async (
        forCanisterId?: string,
        forceRefresh = false,
    ) => {
        const balances: { [key: string]: string } = getBalancesLocal();
        const canisters = getCanistersLocal();
        if (user && (forceRefresh || Object.keys(balances).length === 0)) {
            await Promise.allSettled(
                canisters
                    .filter(
                        ([canisterId]) =>
                            !forCanisterId || forCanisterId === canisterId,
                    )
                    .map(([canisterId]) =>
                        window.api
                            .account_balance(Principal.from(canisterId), {
                                owner: Principal.from(user.principal),
                            })
                            .then(
                                (balance) =>
                                    (balances[canisterId] =
                                        new Number(balance).toString() || "0"),
                            )
                            .catch(() => (balances[canisterId] = "NaN")),
                    ),
            );
            localStorage.setItem(USER_BALANCES_KEY, JSON.stringify(balances));
        }
        setCanisterBalances(balances);
    };

    React.useEffect(() => {
        loadIcrc1Canisters();
    }, []);

    const addIcrc1CanisterPrompt = async () => {
        const canisterId = prompt(`Icrc1 canister id`) || "";
        if (!canisterId) {
            return;
        }
        try {
            Principal.fromText(canisterId);

            const meta = await window.api.icrc_metadata(canisterId);
            if (!meta) {
                throw new Error("Could not find Icrc1 canister data");
            }

            const canisters = getCanistersLocal();
            const existingCanister = canisters.find(
                ([id]) => id === canisterId,
            );
            if (existingCanister) {
                return alert(
                    `Token ${existingCanister[1].symbol} was already added`,
                );
            }

            canisters.push([canisterId, meta]);

            localStorage.setItem(USER_CANISTERS_KEY, JSON.stringify(canisters));

            setIcrc1Canisters(canisters);

            await loadIcrc1CanisterBalances(canisterId, true);
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
                await loadIcrc1CanisterBalances(canisterId, true);
            }
        } catch (e: any) {
            alert(e.message);
        }
    };

    return (
        <>
            <div style={{ marginBottom: 4 }}>
                <ButtonWithLoading
                    onClick={addIcrc1CanisterPrompt}
                    label={"Add token"}
                ></ButtonWithLoading>
                <ButtonWithLoading
                    onClick={() => loadIcrc1CanisterBalances(undefined, true)}
                    label={"Refresh balances"}
                ></ButtonWithLoading>
            </div>
            {icrc1Canisters.length > 0 && (
                <table className="icrc1-canisters">
                    <tbody>
                        {icrc1Canisters.map(([canisterId, info]) => (
                            <tr key={canisterId}>
                                <td className="monospace">{info.symbol}</td>
                                <td>
                                    <img
                                        style={{
                                            height: 32,
                                            width: 32,
                                            verticalAlign: "middle",
                                        }}
                                        src={
                                            info.logo_params
                                                ? bucket_image_url(
                                                      ...info.logo_params,
                                                  )
                                                : info.logo
                                        }
                                    />
                                </td>
                                <td className="hide-mobile">
                                    <a
                                        href={`https://dashboard.internetcomputer.org/canister/${canisterId}`}
                                        target="_blank"
                                    >
                                        {canisterId}
                                    </a>
                                </td>

                                <td
                                    style={{ textAlign: "right", width: "99%" }}
                                >
                                    <ButtonWithLoading
                                        classNameArg="send"
                                        onClick={() =>
                                            loadIcrc1CanisterBalances(
                                                canisterId,
                                                true,
                                            )
                                        }
                                        label={<Repost></Repost>}
                                    ></ButtonWithLoading>
                                </td>
                                <td>
                                    <ButtonWithLoading
                                        classNameArg="send"
                                        onClick={() =>
                                            icrcTransferPrompts(
                                                canisterId,
                                                info,
                                            )
                                        }
                                        label={"Send"}
                                    ></ButtonWithLoading>
                                </td>
                                <td>
                                    <span className="monospace">{`${(+canisterBalances[canisterId] / Math.pow(10, info.decimals))?.toFixed(info.decimals)}`}</span>
                                </td>
                                <td>
                                    <CopyToClipboard
                                        value={user.principal}
                                        displayMap={() => `Receive`}
                                    ></CopyToClipboard>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </>
    );
};
