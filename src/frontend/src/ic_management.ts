// Shared IC management-canister ("aaaaa-aa") definitions used by both the API
// layer and the bucket-creation flow.
import { IDL } from "@dfinity/candid";
import { Principal } from "@dfinity/principal";

export const MANAGEMENT_CANISTER_ID = Principal.fromText("aaaaa-aa");

// Blackhole exposes canister_status publicly, so making it a controller of a
// canister lets cycles top-up services (and our UI) read that canister's cycle
// balance without taggr needing to be a controller.
export const BLACKHOLE_PRINCIPAL = Principal.fromText(
    "e3mmv-5qaaa-aaaah-aadma-cai",
);

export const CanisterSettingsIDL = IDL.Record({
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

// Every settings field unset; spread it and override only what you need.
export const emptyCanisterSettings = {
    compute_allocation: [],
    memory_allocation: [],
    freezing_threshold: [],
    reserved_cycles_limit: [],
    log_visibility: [],
    wasm_memory_limit: [],
    wasm_memory_threshold: [],
};
