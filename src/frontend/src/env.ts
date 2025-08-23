export const STAGING_MODE = process.env.DFX_NETWORK == "staging";

export const MAINNET_MODE = STAGING_MODE || process.env.DFX_NETWORK == "ic";

export const CANISTER_ID = process.env.CANISTER_ID || "";

export const II_URL = MAINNET_MODE
    ? "https://id.ai"
    : "http://localhost:8080/?canisterId=qhbym-qaaaa-aaaaa-aaafq-cai";
