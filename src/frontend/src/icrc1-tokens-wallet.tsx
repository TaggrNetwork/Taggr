import * as React from "react";
import { ButtonWithLoading, CopyToClipboard } from "./common";
import { Principal } from "@dfinity/principal";
import { Icrc1Canister } from "./types";
import { bucket_image_url } from "./util";

export const Icrc1TokensWallet = () => {
    const [user] = React.useState(window.user);
    const [icrc1Canisters, setIcrc1Canisters] = React.useState<
        Array<[string, Icrc1Canister]>
    >([]);
    const [canisterBalances, setCanisterBalances] = React.useState<{
        [key: string]: string;
    }>({});

    const loadIcrc1Canisters = async () => {
        const canisters: Array<[string, Icrc1Canister]> =
            (await window.api.query("icrc1_canisters")) || [];
        setIcrc1Canisters(canisters);

        loadIcrc1CanisterBalances(canisters);
    };

    const loadIcrc1CanisterBalances = async (
        canisters: Array<[string, Icrc1Canister]>,
        forCanisterId?: string,
    ) => {
        const balances: { [key: string]: string } = { ...canisterBalances };

        if (user) {
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
                            .catch(() => (balances[canisterId] = "0")),
                    ),
            );
        }

        setCanisterBalances(balances);
    };

    React.useEffect(() => {
        loadIcrc1Canisters();
    }, []);

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
                await loadIcrc1CanisterBalances(icrc1Canisters, canisterId);
            }
        } catch (e: any) {
            alert(e.message);
        }
    };

    return (
        <>
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
                                            icrcTransferPrompts(
                                                canisterId,
                                                info,
                                            )
                                        }
                                        label={"Send"}
                                    ></ButtonWithLoading>
                                </td>
                                <td>
                                    <span
                                        style={{ fontWeight: "bold" }}
                                    >{`${(+canisterBalances[canisterId] / Math.pow(10, info.decimals))?.toFixed(info.decimals)}`}</span>
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
