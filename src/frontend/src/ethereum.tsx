import * as React from "react";
import {
    ButtonWithLoading,
    CopyToClipboard,
    HeadBar,
    Loading,
    bigScreen,
    confirmPopUp,
    handleError,
    showPopUp,
    token,
    tokenBalance,
} from "./common";
import { EthConfig, EthMintRecipe } from "./types";

type Eip1193Provider = {
    request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
    on?: (event: string, handler: (...args: any[]) => void) => void;
    removeListener?: (event: string, handler: (...args: any[]) => void) => void;
};

const provider = (): Eip1193Provider | undefined =>
    (window as unknown as { ethereum?: Eip1193Provider }).ethereum;

const WEI_PER_BASE = BigInt("10000000000000000");
const MINT_SELECTOR = "0xf0d0a6df";
const USED_SELECTOR = "0x04eb9d7a";

const word = (value: bigint) => value.toString(16).padStart(64, "0");

const shortenAddress = (address: string) =>
    `${address.slice(0, 6)}...${address.slice(-4)}`;

const parseAmount = (value: string): number | null => {
    const decimals = window.backendCache.config.token_decimals as number;
    const trimmed = value.trim();
    if (!trimmed) return null;
    const [whole, fraction = ""] = trimmed.split(".");
    if (!/^\d*$/.test(whole) || !/^\d*$/.test(fraction)) return null;
    if (fraction.length > decimals) return null;
    return (
        Number(whole || "0") * Math.pow(10, decimals) +
        Number(fraction.padEnd(decimals, "0"))
    );
};

const encodeMint = (recipe: EthMintRecipe): string => {
    const signature = recipe.signature
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
    const padded = signature.padEnd(Math.ceil(signature.length / 64) * 64, "0");
    const address = recipe.eth_address.toLowerCase().replace(/^0x/, "");
    const amount = word(BigInt(recipe.amount) * WEI_PER_BASE);
    const index = word(BigInt(recipe.index));
    const offset = word(BigInt(0x80));
    const length = word(BigInt(recipe.signature.length));
    return (
        MINT_SELECTOR +
        address.padStart(64, "0") +
        amount +
        index +
        offset +
        length +
        padded
    );
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const Ethereum = () => {
    const [canisterAddress, setCanisterAddress] = React.useState<
        string | null
    >();
    const [config, setConfig] = React.useState<EthConfig | null>(null);
    const [account, setAccount] = React.useState<string | null>(null);
    const [chainId, setChainId] = React.useState<number | null>(null);
    const [recipes, setRecipes] = React.useState<EthMintRecipe[]>([]);
    const [amount, setAmount] = React.useState("");
    const [submitted, setSubmitted] = React.useState<Record<number, string>>(
        {},
    );

    const [user, setUser] = React.useState(window.user);

    React.useEffect(() => {
        (async () => {
            setCanisterAddress(await window.api.query<string>("eth_address"));
            setConfig(await window.api.query<EthConfig>("eth_config"));
            if (window.user) {
                const loaded =
                    await window.api.query<EthMintRecipe[]>("eth_recipes");
                setRecipes(loaded || []);
            }
        })();
    }, []);

    React.useEffect(() => {
        const wallet = provider();
        if (!wallet) return;
        wallet
            .request({ method: "eth_accounts" })
            .then((accounts) => {
                const list = accounts as string[];
                if (list.length > 0) setAccount(list[0]);
            })
            .catch(() => {});
        wallet
            .request({ method: "eth_chainId" })
            .then((id) => setChainId(parseInt(id as string, 16)))
            .catch(() => {});

        const onAccounts = (accounts: unknown) => {
            const list = accounts as string[];
            setAccount(list.length > 0 ? list[0] : null);
        };
        const onChain = (id: unknown) => setChainId(parseInt(id as string, 16));
        wallet.on?.("accountsChanged", onAccounts);
        wallet.on?.("chainChanged", onChain);
        return () => {
            wallet.removeListener?.("accountsChanged", onAccounts);
            wallet.removeListener?.("chainChanged", onChain);
        };
    }, []);

    // Mark recipes that were already minted on L1.
    React.useEffect(() => {
        const wallet = provider();
        if (
            !wallet ||
            !account ||
            !config ||
            !config.token_address ||
            chainId !== config.chain_id ||
            recipes.length === 0
        ) {
            return;
        }
        let cancelled = false;
        (async () => {
            const used: Record<number, string> = {};
            for (const recipe of recipes) {
                try {
                    const data = USED_SELECTOR + word(BigInt(recipe.index));
                    const result = (await wallet.request({
                        method: "eth_call",
                        params: [{ to: config.token_address, data }, "latest"],
                    })) as string;
                    if (BigInt(result) === BigInt(1))
                        used[recipe.index] = "used";
                } catch {}
            }
            if (!cancelled) {
                setSubmitted((previous) => ({ ...previous, ...used }));
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [recipes, account, chainId, config]);

    const connect = async () => {
        const wallet = provider();
        if (!wallet) {
            showPopUp("error", "No Ethereum wallet found in this browser");
            return;
        }
        try {
            const accounts = (await wallet.request({
                method: "eth_requestAccounts",
            })) as string[];
            setAccount(accounts[0] ?? null);
            const id = (await wallet.request({
                method: "eth_chainId",
            })) as string;
            setChainId(parseInt(id, 16));
        } catch (error) {
            showPopUp("error", (error as Error).message);
        }
    };

    const switchChain = async () => {
        const wallet = provider();
        if (!wallet || !config) return;
        try {
            await wallet.request({
                method: "wallet_switchEthereumChain",
                params: [{ chainId: `0x${config.chain_id.toString(16)}` }],
            });
        } catch (error) {
            showPopUp("error", (error as Error).message);
        }
    };

    const disconnect = async () => {
        // Not a standard EIP-1193 method: wallets that support it forget the
        // site's accounts, the rest only forget it locally below.
        try {
            await provider()?.request({
                method: "wallet_revokePermissions",
                params: [{ eth_accounts: {} }],
            });
        } catch {}
        setAccount(null);
    };

    const bridge = async () => {
        if (!user) return showPopUp("error", "Log in to bridge");
        if (!account)
            return showPopUp("error", "Connect an Ethereum wallet first");
        if (!config) return;
        if (chainId !== config.chain_id) {
            return showPopUp(
                "error",
                `Switch your wallet to chain ${config.chain_id}`,
            );
        }
        const parsed = parseAmount(amount);
        if (parsed === null) return showPopUp("error", "Invalid amount");
        if (parsed < config.min_amount) {
            return showPopUp(
                "error",
                `The minimum bridging amount is ${token(config.min_amount)} ${
                    window.backendCache.config.token_symbol
                }`,
            );
        }
        if (parsed > user.balance) {
            return showPopUp("error", "Not enough tokens");
        }

        const symbol = window.backendCache.config.token_symbol;
        const proceed = await confirmPopUp(
            `Burn ${tokenBalance(parsed)} ${symbol} to mint them on Ethereum L1 for ${shortenAddress(account)}?`,
            { confirmLabel: "Burn", cancelLabel: "Cancel" },
        );
        if (!proceed) return;

        const response = await window.api.call<
            { Ok: EthMintRecipe } | { Err: string }
        >("bridge_out", parsed, account);
        if (handleError(response)) return;
        const recipe = (response as { Ok: EthMintRecipe }).Ok;
        setRecipes((previous) => [recipe, ...previous]);
        setAmount("");
        await window.reloadUser();
        setUser(window.user);
    };

    const submit = async (recipe: EthMintRecipe) => {
        const wallet = provider();
        if (!wallet || !account || !config) {
            return showPopUp("error", "Connect an Ethereum wallet first");
        }
        if (chainId !== config.chain_id) {
            return showPopUp(
                "error",
                `Switch your wallet to chain ${config.chain_id}`,
            );
        }
        try {
            const hash = (await wallet.request({
                method: "eth_sendTransaction",
                params: [
                    {
                        from: account,
                        to: config.token_address,
                        data: encodeMint(recipe),
                        value: "0x0",
                    },
                ],
            })) as string;
            setSubmitted((previous) => ({ ...previous, [recipe.index]: hash }));

            for (let attempt = 0; attempt < 60; attempt++) {
                await sleep(2000);
                const receipt = (await wallet.request({
                    method: "eth_getTransactionReceipt",
                    params: [hash],
                })) as { status?: string } | null;
                if (!receipt) continue;
                if (receipt.status === "0x1") {
                    setSubmitted((previous) => ({
                        ...previous,
                        [recipe.index]: "used",
                    }));
                    showPopUp("success", "Recipe submitted to the L1 token");
                } else {
                    setSubmitted((previous) => {
                        const next = { ...previous };
                        delete next[recipe.index];
                        return next;
                    });
                    showPopUp("error", "The L1 transaction reverted");
                }
                return;
            }
            showPopUp("error", "The L1 transaction is still pending");
        } catch (error) {
            showPopUp("error", (error as Error).message);
        }
    };

    if (canisterAddress === undefined || !config) return <Loading />;

    const configured =
        config.token_address.length > 0 &&
        config.token_address !== "0x0000000000000000000000000000000000000000";

    return (
        <>
            <HeadBar title="Ethereum" shareLink="ethereum" />
            <div className="column_container spaced">
                <p className="stands_out">
                    TAGGR is migrating to an ERC20 on Ethereum L1. Phase 1 is a
                    one-way bridge: tokens burned here are minted on L1 by a
                    recipe signed by the canister.
                </p>

                <h2 className="section_heading">
                    {window.backendCache.config.name} L1 address
                </h2>
                {canisterAddress ? (
                    <CopyToClipboard
                        value={canisterAddress}
                        testId="eth-address"
                        classNameArg="bottom_spaced"
                    />
                ) : (
                    <p className="bottom_spaced">
                        The address hasn't been derived yet.
                    </p>
                )}

                <h2 className="section_heading">Bridge</h2>
                <p className="stands_out">
                    ⚠️ Testing phase: bridged tokens live on Ethereum L1 and{" "}
                    <strong>cannot take part in Taggr governance yet</strong>.
                    Bridge only small amounts that you are ready to test with.
                </p>
                <p>
                    Bridging <strong>burns</strong>{" "}
                    {window.backendCache.config.token_symbol}, then lets you
                    submit the signed mint recipe to the L1 token. The signing
                    fee is charged in credits and gas is paid by your wallet.
                </p>

                {!configured && (
                    <p className="stands_out error">
                        ⚠️ The L1 token address is not configured on the
                        canister yet.
                    </p>
                )}

                {!user && configured && (
                    <p className="bottom_spaced">
                        Log in to create a bridge recipe.
                    </p>
                )}

                {user && configured && (
                    <>
                        {account ? (
                            <>
                                <div className="row_container vcentered bottom_spaced">
                                    <span className="right_half_spaced">
                                        Connected wallet:
                                    </span>
                                    {config.chain_id === 1 ? (
                                        <a
                                            className="monospace"
                                            href={`https://etherscan.io/address/${account}`}
                                            target="_blank"
                                            rel="noreferrer"
                                        >
                                            {bigScreen()
                                                ? account
                                                : shortenAddress(account)}
                                        </a>
                                    ) : (
                                        <span className="monospace">
                                            {bigScreen()
                                                ? account
                                                : shortenAddress(account)}
                                        </span>
                                    )}
                                    {chainId !== config.chain_id && (
                                        <>
                                            <span className="left_half_spaced right_half_spaced error">
                                                ⚠️ Wrong network
                                            </span>
                                            <ButtonWithLoading
                                                label="Switch"
                                                onClick={switchChain}
                                            />
                                        </>
                                    )}
                                </div>
                                <div className="vcentered bottom_spaced">
                                    <input
                                        type="number"
                                        min="0"
                                        step="any"
                                        placeholder="Amount"
                                        className="short_input right_half_spaced"
                                        value={amount}
                                        onChange={(event) =>
                                            setAmount(event.target.value)
                                        }
                                    />
                                    <span className="right_half_spaced">
                                        Balance: {tokenBalance(user.balance)}{" "}
                                        {
                                            window.backendCache.config
                                                .token_symbol
                                        }
                                    </span>
                                </div>
                                <div className="vcentered bottom_spaced">
                                    <ButtonWithLoading
                                        label="Disconnect"
                                        onClick={disconnect}
                                        classNameArg="max_width_col right_half_spaced"
                                    />
                                    <ButtonWithLoading
                                        label="Bridge"
                                        onClick={bridge}
                                        disabled={!amount}
                                        classNameArg="active max_width_col left_half_spaced"
                                    />
                                </div>
                                <p className="small_text bottom_spaced">
                                    Minimum: {token(config.min_amount)}{" "}
                                    {window.backendCache.config.token_symbol}.
                                    Signing fee: {config.fee_credits} credits.
                                </p>
                            </>
                        ) : (
                            <ButtonWithLoading
                                label="Connect wallet"
                                onClick={connect}
                                classNameArg="bottom_spaced"
                            />
                        )}
                    </>
                )}

                <h2 className="section_heading">My recipes</h2>
                {!user ? (
                    <p>Log in to see your bridge recipes.</p>
                ) : recipes.length === 0 ? (
                    <p>No bridge recipes yet.</p>
                ) : (
                    <div className="column_container">
                        {recipes.map((recipe) => {
                            const state = submitted[recipe.index];
                            return (
                                <div
                                    className="bottom_spaced"
                                    key={recipe.index}
                                >
                                    <div className="row_container vcentered bottom_half_spaced">
                                        <span className="max_width_col">
                                            <code>#{recipe.index}</code>{" "}
                                            &middot;{" "}
                                            <code>
                                                {tokenBalance(recipe.amount)}{" "}
                                                {
                                                    window.backendCache.config
                                                        .token_symbol
                                                }
                                            </code>{" "}
                                            &rarr;{" "}
                                            <CopyToClipboard
                                                value={recipe.eth_address}
                                                displayMap={(address) =>
                                                    shortenAddress(
                                                        String(address),
                                                    )
                                                }
                                            />
                                        </span>
                                        {state === "used" ? (
                                            <span>✅ Minted</span>
                                        ) : state ? (
                                            config.chain_id === 1 ? (
                                                <a
                                                    href={`https://etherscan.io/tx/${state}`}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                >
                                                    ⏳ Pending
                                                </a>
                                            ) : (
                                                <span>⏳ Pending</span>
                                            )
                                        ) : (
                                            <ButtonWithLoading
                                                label="Submit"
                                                onClick={() => submit(recipe)}
                                                disabled={
                                                    !configured ||
                                                    !account ||
                                                    chainId !== config.chain_id
                                                }
                                            />
                                        )}
                                    </div>
                                    <div className="small_text">
                                        Burn transaction{" "}
                                        <a
                                            href={`#/transaction/${recipe.burn_block}`}
                                        >
                                            #{recipe.burn_block}
                                        </a>
                                        {state && state !== "used"
                                            ? " · mint transaction in flight"
                                            : ""}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </>
    );
};
