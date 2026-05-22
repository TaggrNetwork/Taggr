// End-to-end bucket creation flow: ICP → CMC → install → register with taggr.
// State persists on the user's server-side `settings` map so the flow survives
// reloads AND cross-browser handoff — by step 1 the user has paid real ICP and
// must be able to resume from any device.

import { Principal } from "@dfinity/principal";
import { IDL } from "@dfinity/candid";
import { AccountIdentifier, SubAccount } from "@dfinity/ledger-icp";
import { CANISTER_ID } from "./env";

const TAGGR_PRINCIPAL = Principal.fromText(CANISTER_ID);
const CMC_PRINCIPAL = Principal.fromText("rkp4c-7iaaa-aaaaa-aaaca-cai");
const MANAGEMENT_PRINCIPAL = Principal.fromText("aaaaa-aa");
const BLACKHOLE_PRINCIPAL = Principal.fromText("e3mmv-5qaaa-aaaah-aadma-cai");
const MEMO_CREATE_CANISTER = 0x41455243; // "CREA"
// Stored on user settings (server-side) so the flow survives across browsers —
// the user has paid real ICP by step 1 and we must be able to resume from any
// device.
const STATE_KEY = "bucket_creation_state";

type State =
    | { stage: "transferred"; blockIndex: string }
    | { stage: "created"; canisterId: string }
    | { stage: "controllers_set"; canisterId: string }
    | { stage: "installed"; canisterId: string };

export type Stage =
    | "transferring"
    | "creating"
    | "setting_controllers"
    | "installing"
    | "registering";

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
    const response: any = await window.api.call("update_user_settings", settings);
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

const CanisterSettingsIDL = IDL.Record({
    controllers: IDL.Opt(IDL.Vec(IDL.Principal)),
    compute_allocation: IDL.Opt(IDL.Nat),
    memory_allocation: IDL.Opt(IDL.Nat),
    freezing_threshold: IDL.Opt(IDL.Nat),
    reserved_cycles_limit: IDL.Opt(IDL.Nat),
    log_visibility: IDL.Opt(
        IDL.Variant({ controllers: IDL.Null, public: IDL.Null }),
    ),
    wasm_memory_limit: IDL.Opt(IDL.Nat),
    wasm_memory_threshold: IDL.Opt(IDL.Nat),
});

const emptyCanisterSettings = {
    compute_allocation: [],
    memory_allocation: [],
    freezing_threshold: [],
    reserved_cycles_limit: [],
    log_visibility: [],
    wasm_memory_limit: [],
    wasm_memory_threshold: [],
};

const decodeReply = <T>(idl: any[], buf: ArrayBuffer | null, label: string): T => {
    if (!buf) throw new Error(`${label}: empty reply`);
    return IDL.decode(idl, buf)[0] as T;
};

export const createBucket = async (
    userPrincipal: Principal,
    amountE8s: number,
    onStage: (s: Stage) => void = () => {},
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
                `ICP transfer to CMC failed: ${JSON.stringify(transferResult)}`,
            );
        }
        blockIndex = BigInt(transferResult.Ok);
        saved = { stage: "transferred", blockIndex: blockIndex.toString() };
        await saveState(saved);
    }

    // STEP 2: CMC notify_create_canister.
    let canisterId: Principal;
    if (
        saved.stage === "created" ||
        saved.stage === "controllers_set" ||
        saved.stage === "installed"
    ) {
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
                    settings: [],
                },
            ],
        );
        const buf = await window.api.call_raw(
            CMC_PRINCIPAL,
            "notify_create_canister",
            arg,
        );
        const decoded = decodeReply<any>([NotifyResult], buf, "notify_create_canister");
        if ("Err" in decoded) {
            throw new Error(`CMC reported ${JSON.stringify(decoded.Err)}`);
        }
        canisterId = decoded.Ok as Principal;
        saved = { stage: "created", canisterId: canisterId.toString() };
        await saveState(saved);
    }

    // STEP 3: management.update_settings → [user, taggr, blackhole].
    if (saved.stage === "created") {
        onStage("setting_controllers");
        const UpdateSettingsArgs = IDL.Record({
            canister_id: IDL.Principal,
            settings: CanisterSettingsIDL,
            sender_canister_version: IDL.Opt(IDL.Nat64),
        });
        const arg = IDL.encode(
            [UpdateSettingsArgs],
            [
                {
                    canister_id: canisterId,
                    settings: {
                        controllers: [
                            [
                                userPrincipal,
                                TAGGR_PRINCIPAL,
                                BLACKHOLE_PRINCIPAL,
                            ],
                        ],
                        ...emptyCanisterSettings,
                    },
                    sender_canister_version: [],
                },
            ],
        );
        await window.api.call_raw(MANAGEMENT_PRINCIPAL, "update_settings", arg);
        saved = { stage: "controllers_set", canisterId: canisterId.toString() };
        await saveState(saved);
    }

    // STEP 4: management.install_code with bucket wasm; init arg = candid Vec<Principal>.
    if (saved.stage === "controllers_set") {
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
            IDL.encode(
                [IDL.Vec(IDL.Principal)],
                [[userPrincipal, TAGGR_PRINCIPAL]],
            ),
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
        await window.api.call_raw(MANAGEMENT_PRINCIPAL, "install_code", arg);
        saved = { stage: "installed", canisterId: canisterId.toString() };
        await saveState(saved);
    }

    // STEP 5: taggr.set_bucket(canisterId).
    onStage("registering");
    const setBucketArg = IDL.encode([IDL.Principal], [canisterId]);
    const buf = await window.api.call_raw(
        TAGGR_PRINCIPAL,
        "set_bucket",
        setBucketArg,
    );
    const result = decodeReply<any>(
        [IDL.Variant({ Ok: IDL.Null, Err: IDL.Text })],
        buf,
        "set_bucket",
    );
    if ("Err" in result) {
        throw new Error(`taggr.set_bucket failed: ${result.Err}`);
    }

    await clearState();
    return canisterId;
};
