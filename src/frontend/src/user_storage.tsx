// User storage canister ("bucket"): the end-to-end creation/top-up flow plus the
// shared UI (status fetch, creation modal used by both the post form banner and
// the settings tab, and the low-runway top-up prompt). Keeping the flow and its
// UI together avoids duplicating either between `form.tsx` and `settings.tsx`.

import * as React from "react";
import { Principal } from "@dfinity/principal";
import { IDL } from "@dfinity/candid";
import { AccountIdentifier, SubAccount } from "@dfinity/ledger-icp";
import { CANISTER_ID } from "./env";
import {
    BLACKHOLE_PRINCIPAL,
    CanisterSettingsIDL,
    emptyCanisterSettings,
    MANAGEMENT_CANISTER_ID,
} from "./ic_management";
import {
    ButtonWithLoading,
    confirmPopUp,
    errorText,
    popUp,
    shortenTokensAmount,
    showPopUp,
} from "./common";
import { CanisterStatus } from "./types";
import { StorageCanister } from "./icons";

const CMC_PRINCIPAL = Principal.fromText("rkp4c-7iaaa-aaaaa-aaaca-cai");
const MEMO_CREATE_CANISTER = 0x41455243; // "CREA"
const MEMO_TOP_UP_CANISTER = 0x50555054; // "TPUP"

// Shared CMC error variant returned by notify_create_canister & notify_top_up.
const NotifyError = IDL.Variant({
    Refunded: IDL.Record({
        reason: IDL.Text,
        block_index: IDL.Opt(IDL.Nat64),
    }),
    InvalidTransaction: IDL.Text,
    TransactionTooOld: IDL.Nat64,
    Processing: IDL.Null,
    Other: IDL.Record({
        error_code: IDL.Nat64,
        error_message: IDL.Text,
    }),
});
// Stored on user settings (server-side) so the flow survives across browsers —
// the user has paid real ICP by step 1 and we must be able to resume from any
// device.
const STATE_KEY = "bucket_creation_state";

type State =
    | { stage: "transferred"; blockIndex: string }
    | { stage: "created"; canisterId: string }
    | { stage: "installed"; canisterId: string };

export type Stage = "transferring" | "creating" | "installing" | "registering";

const loadState = (): State | null => {
    const raw = window.user?.settings?.[STATE_KEY];
    if (!raw) return null;
    try {
        return JSON.parse(raw) as State;
    } catch {
        return null;
    }
};

const persistSettings = async (settings: { [k: string]: string }) => {
    const response: any = await window.api.call(
        "update_user_settings",
        settings,
    );
    if (response && "Err" in response) {
        throw new Error(`failed to persist bucket state: ${response.Err}`);
    }
    if (window.user) window.user.settings = settings;
};

const saveState = async (s: State) => {
    const settings = {
        ...(window.user?.settings || {}),
        [STATE_KEY]: JSON.stringify(s),
    };
    await persistSettings(settings);
};

const clearState = async () => {
    const settings = { ...(window.user?.settings || {}) };
    if (!(STATE_KEY in settings)) return;
    delete settings[STATE_KEY];
    await persistSettings(settings);
};

const decodeReply = <T,>(
    idl: any[],
    buf: ArrayBuffer | null,
    label: string,
): T => {
    if (!buf) throw new Error(`${label}: empty reply`);
    return IDL.decode(idl, buf)[0] as T;
};

export const createBucket = async (
    userPrincipal: Principal,
    amountE8s: number,
    onStage: (s: Stage) => void = () => {},
    // Called when CMC refunds the payment (the saved attempt is unrecoverable).
    // Return true to restart with a fresh transfer, false to abort.
    onRefund: () => Promise<boolean> | boolean = () => false,
): Promise<Principal> => {
    let saved = loadState();

    // STEP 1: ICP transfer to CMC subaccount, memo CREA.
    let blockIndex: bigint | null = null;
    if (saved?.stage === "transferred") {
        blockIndex = BigInt(saved.blockIndex);
    } else if (!saved) {
        onStage("transferring");
        const accountId = AccountIdentifier.fromPrincipal({
            principal: CMC_PRINCIPAL,
            subAccount: SubAccount.fromPrincipal(userPrincipal),
        }).toHex();
        const transferResult: any = await window.api.icp_transfer(
            accountId,
            amountE8s,
            MEMO_CREATE_CANISTER,
        );
        if (!transferResult || "Err" in transferResult) {
            throw new Error(
                `ICP transfer to CMC failed: ${JSON.stringify(
                    transferResult,
                    (_, v) => (typeof v === "bigint" ? v.toString() : v),
                )}`,
            );
        }
        blockIndex = BigInt(transferResult.Ok);
        saved = { stage: "transferred", blockIndex: blockIndex.toString() };
        await saveState(saved);
    }

    // STEP 2: CMC notify_create_canister. Controllers baked in at creation time:
    // user + blackhole — taggr is intentionally NOT a controller.
    let canisterId: Principal;
    if (saved.stage === "created" || saved.stage === "installed") {
        canisterId = Principal.fromText(saved.canisterId);
    } else {
        onStage("creating");
        const NotifyCreateCanisterArg = IDL.Record({
            block_index: IDL.Nat64,
            controller: IDL.Principal,
            subnet_selection: IDL.Opt(
                IDL.Variant({
                    Subnet: IDL.Record({ subnet: IDL.Principal }),
                    Filter: IDL.Record({ subnet_type: IDL.Opt(IDL.Text) }),
                }),
            ),
            settings: IDL.Opt(CanisterSettingsIDL),
        });
        const NotifyResult = IDL.Variant({
            Ok: IDL.Principal,
            Err: NotifyError,
        });
        const arg = IDL.encode(
            [NotifyCreateCanisterArg],
            [
                {
                    block_index: blockIndex,
                    controller: userPrincipal,
                    subnet_selection: [],
                    settings: [
                        {
                            controllers: [[userPrincipal, BLACKHOLE_PRINCIPAL]],
                            ...emptyCanisterSettings,
                        },
                    ],
                },
            ],
        );
        const buf = await window.api.call_raw(
            CMC_PRINCIPAL,
            "notify_create_canister",
            arg,
        );
        const decoded = decodeReply<any>(
            [NotifyResult],
            buf,
            "notify_create_canister",
        );
        if ("Err" in decoded) {
            // Refunded means CMC returned the ICP to the user, so the saved
            // block_index is spent — reusing it just re-refunds forever. Clear
            // the dead state, then offer to restart with a fresh transfer.
            if ("Refunded" in decoded.Err) {
                await clearState();
                if (await onRefund()) {
                    return createBucket(
                        userPrincipal,
                        amountE8s,
                        onStage,
                        onRefund,
                    );
                }
            }
            throw new Error(`CMC reported ${JSON.stringify(decoded.Err)}`);
        }
        canisterId = decoded.Ok as Principal;
        saved = { stage: "created", canisterId: canisterId.toString() };
        await saveState(saved);
    }

    // STEP 3: management.install_code with bucket wasm; init arg = candid Vec<Principal>[user].
    if (saved.stage === "created") {
        onStage("installing");
        const wasmBuf = await window.api.query_raw(
            CANISTER_ID,
            "bucket_wasm",
            new ArrayBuffer(0),
        );
        const wasm = decodeReply<Uint8Array | number[]>(
            [IDL.Vec(IDL.Nat8)],
            wasmBuf,
            "bucket_wasm",
        );
        const initArg = new Uint8Array(
            IDL.encode([IDL.Vec(IDL.Principal)], [[userPrincipal]]),
        );
        const InstallCodeArgs = IDL.Record({
            mode: IDL.Variant({
                install: IDL.Null,
                reinstall: IDL.Null,
                upgrade: IDL.Opt(
                    IDL.Record({
                        skip_pre_upgrade: IDL.Opt(IDL.Bool),
                        wasm_memory_persistence: IDL.Opt(
                            IDL.Variant({ keep: IDL.Null, replace: IDL.Null }),
                        ),
                    }),
                ),
            }),
            canister_id: IDL.Principal,
            wasm_module: IDL.Vec(IDL.Nat8),
            arg: IDL.Vec(IDL.Nat8),
            sender_canister_version: IDL.Opt(IDL.Nat64),
        });
        const arg = IDL.encode(
            [InstallCodeArgs],
            [
                {
                    mode: { install: null },
                    canister_id: canisterId,
                    wasm_module: wasm,
                    arg: initArg,
                    sender_canister_version: [],
                },
            ],
        );
        await window.api.call_raw(
            MANAGEMENT_CANISTER_ID,
            "install_code",
            arg,
            canisterId,
        );
        saved = { stage: "installed", canisterId: canisterId.toString() };
        await saveState(saved);
    }

    // STEP 4: taggr.set_bucket(canisterId).
    onStage("registering");
    const result: any = await window.api.call(
        "set_bucket",
        canisterId.toString(),
    );
    if (result && "Err" in result) {
        throw new Error(`taggr.set_bucket failed: ${result.Err}`);
    }

    await clearState();
    return canisterId;
};

// Top up a canister with cycles: ICP → CMC (memo TPUP, subaccount derived from
// the target canister) → notify_top_up mints cycles into the canister. Returns
// the number of cycles minted. No resumable state — a single, self-contained op.
export const topUpCanister = async (
    canisterId: Principal,
    amountE8s: number,
): Promise<bigint> => {
    const accountId = AccountIdentifier.fromPrincipal({
        principal: CMC_PRINCIPAL,
        subAccount: SubAccount.fromPrincipal(canisterId),
    }).toHex();
    const transferResult: any = await window.api.icp_transfer(
        accountId,
        amountE8s,
        MEMO_TOP_UP_CANISTER,
    );
    if (!transferResult || "Err" in transferResult) {
        throw new Error(
            `ICP transfer to CMC failed: ${JSON.stringify(
                transferResult,
                (_, v) => (typeof v === "bigint" ? v.toString() : v),
            )}`,
        );
    }
    const blockIndex = BigInt(transferResult.Ok);

    const NotifyTopUpArg = IDL.Record({
        block_index: IDL.Nat64,
        canister_id: IDL.Principal,
    });
    const NotifyTopUpResult = IDL.Variant({ Ok: IDL.Nat, Err: NotifyError });
    const arg = IDL.encode(
        [NotifyTopUpArg],
        [{ block_index: blockIndex, canister_id: canisterId }],
    );
    const buf = await window.api.call_raw(CMC_PRINCIPAL, "notify_top_up", arg);
    const decoded = decodeReply<any>([NotifyTopUpResult], buf, "notify_top_up");
    if ("Err" in decoded) {
        throw new Error(`CMC top-up reported ${JSON.stringify(decoded.Err)}`);
    }
    return decoded.Ok as bigint;
};

// Blocks dismissal of the creation modal while real ICP is being moved; the
// flow is server-side resumable, but closing mid-way is confusing.
let creationInFlight = false;

export const fetchCanisterStatus = async (
    canisterId: Principal,
): Promise<CanisterStatus> => {
    const DefiniteCanisterSettings = IDL.Record({
        controllers: IDL.Vec(IDL.Principal),
        compute_allocation: IDL.Nat,
        memory_allocation: IDL.Nat,
        freezing_threshold: IDL.Nat,
        reserved_cycles_limit: IDL.Nat,
        log_visibility: IDL.Variant({
            controllers: IDL.Null,
            public: IDL.Null,
            allowed_viewers: IDL.Vec(IDL.Principal),
        }),
        wasm_memory_limit: IDL.Nat,
        wasm_memory_threshold: IDL.Nat,
    });
    const QueryStats = IDL.Record({
        num_calls_total: IDL.Nat,
        num_instructions_total: IDL.Nat,
        request_payload_bytes_total: IDL.Nat,
        response_payload_bytes_total: IDL.Nat,
    });
    const CanisterStatusResult = IDL.Record({
        status: IDL.Variant({
            running: IDL.Null,
            stopping: IDL.Null,
            stopped: IDL.Null,
        }),
        settings: DefiniteCanisterSettings,
        module_hash: IDL.Opt(IDL.Vec(IDL.Nat8)),
        memory_size: IDL.Nat,
        cycles: IDL.Nat,
        reserved_cycles: IDL.Nat,
        idle_cycles_burned_per_day: IDL.Nat,
        query_stats: QueryStats,
    });
    const arg = IDL.encode(
        [IDL.Record({ canister_id: IDL.Principal })],
        [{ canister_id: canisterId }],
    );
    const reply = await window.api.call_raw(
        MANAGEMENT_CANISTER_ID,
        "canister_status",
        arg,
        canisterId,
    );
    if (!reply) throw new Error("empty reply from canister_status");
    const decoded: any = IDL.decode([CanisterStatusResult], reply)[0];
    const statusKey = Object.keys(decoded.status)[0] as
        | "running"
        | "stopping"
        | "stopped";
    const moduleHashOpt = decoded.module_hash as number[][] | Uint8Array[];
    return {
        status: statusKey,
        cycles: decoded.cycles as bigint,
        memory_size: decoded.memory_size as bigint,
        idle_cycles_burned_per_day:
            decoded.idle_cycles_burned_per_day as bigint,
        module_hash:
            moduleHashOpt.length > 0
                ? Array.from(moduleHashOpt[0] as ArrayLike<number>)
                : null,
        controllers: decoded.settings.controllers as Principal[],
    };
};

// Days until the canister runs out of cycles at the current idle burn rate.
// null means an infinite/unknown runway (zero burn).
export const daysToLiveNum = (
    cycles: bigint,
    dailyBurn: bigint,
): number | null => {
    const burn = Number(dailyBurn);
    if (burn <= 0) return null;
    return Math.floor(Number(cycles) / burn);
};

export const daysToLive = (cycles: bigint, dailyBurn: bigint) => {
    const days = daysToLiveNum(cycles, dailyBurn);
    if (days === null) {
        return <code className="xx_large_text">∞</code>;
    }
    const color = days < 30 ? "#e25555" : days < 90 ? "#e0b020" : "#2ecc71";
    return (
        <code className="xx_large_text" style={{ color }}>
            {days.toLocaleString()}
        </code>
    );
};

export const stageLabel = (s: Stage | "done" | null): string => {
    switch (s) {
        case "transferring":
            return "Transferring ICP to CMC…";
        case "creating":
            return "Asking CMC to create canister…";
        case "installing":
            return "Installing bucket WASM…";
        case "registering":
            return `Registering bucket with ${window.backendCache.config.name}…`;
        case "done":
            return "Done";
        default:
            return "";
    }
};

// 1 XDR worth of ICP (in e8s) at the cached rate. 1 XDR ≡ 1T cycles. The CMC
// creation fee is 0.5T on a 13-node subnet and scales linearly with subnet
// size; because we leave `subnet_selection` empty, the CMC picks from its
// default (13-node) subnets, so 1T comfortably covers the fee and leaves the
// fresh canister ~0.5T. This also caps the spend at 1 XDR regardless of the
// ICP price.
const oneXdrE8s = (): number =>
    Number(window.backendCache.stats?.e8s_for_one_xdr || 0);

const StorageCreationModal = ({
    parentCallback,
}: {
    parentCallback?: (id: string | null) => void;
}) => {
    const [stage, setStage] = React.useState<Stage | "done" | null>(null);
    const [error, setError] = React.useState<string | null>(null);
    const amountE8s = oneXdrE8s();

    const run = async () => {
        setError(null);
        creationInFlight = true;
        try {
            const bucketId = await createBucket(
                Principal.fromText(window.principalId),
                amountE8s,
                setStage,
                // Native confirm: a popUp here would clobber this modal in the
                // shared #preview slot.
                () =>
                    confirm(
                        "A previous storage-creation payment was refunded to " +
                            "your wallet because the attempt couldn't be " +
                            `completed. Start over with a fresh ${shortenTokensAmount(
                                amountE8s,
                                8,
                            )} ICP transfer?`,
                    ),
            );
            setStage("done");
            creationInFlight = false;
            await window.reloadUser();
            showPopUp("success", `Storage canister created: ${bucketId}`, 5);
            parentCallback?.(bucketId.toString());
        } catch (err) {
            creationInFlight = false;
            setStage(null);
            setError(errorText(err));
        }
    };

    const inFlight = stage != null && stage !== "done";

    return (
        <div className="column_container" data-testid="storage-creation-modal">
            <h2>
                <StorageCanister classNameArg="right_half_spaced" />
                Personal storage
            </h2>
            <p>
                Create a personal storage canister to attach images to your
                posts. Creating it transfers{" "}
                <code>{shortenTokensAmount(amountE8s, 8)} ICP</code> (≈ 1 XDR)
                from your wallet.
            </p>
            {stage && (
                <p>
                    Status: <code>{stageLabel(stage)}</code>
                </p>
            )}
            {inFlight && (
                <p className="small_text">
                    Do not close this window until the process completes.
                </p>
            )}
            {error && <p className="banner top_spaced">{error}</p>}
            {stage !== "done" && (
                <ButtonWithLoading
                    classNameArg="active top_spaced"
                    onClick={run}
                    label={error ? "RETRY" : "CREATE STORAGE"}
                />
            )}
        </div>
    );
};

// Opens the creation modal; resolves to the new canister id, or null if the
// user closed it without finishing. Dismissal is blocked while in flight.
export const openStorageCreation = (): Promise<string | null> =>
    (popUp<string>(<StorageCreationModal />, {
        closable: () => !creationInFlight,
    }) as Promise<string | null>) || Promise.resolve(null);

// Fetch the storage-canister status and, if it has less than ~3 months of
// runway, prompt the user to top up and send them to settings.
export const maybePromptTopUp = async () => {
    const bucket = window.user?.bucket;
    if (!bucket) return;
    const st = await fetchCanisterStatus(Principal.fromText(bucket)).catch(
        () => null,
    );
    if (!st) return;
    const days = daysToLiveNum(st.cycles, st.idle_cycles_burned_per_day);
    if (days === null || days >= 90) return;
    const ok = await confirmPopUp(
        `Your storage canister will run out of cycles in ~${days} days. ` +
            `Top it up to keep your images available.`,
        { confirmLabel: "TOP UP", cancelLabel: "LATER" },
    );
    if (ok) location.href = "#/settings/STORAGE";
};
