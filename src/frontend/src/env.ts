export const STAGING_MODE =
    process.env.DFX_NETWORK == "staging" ||
    process.env.DFX_NETWORK == "staging2";

export const MAINNET_MODE = STAGING_MODE || process.env.DFX_NETWORK == "ic";

export const CANISTER_ID = process.env.CANISTER_ID || "";

export const II_URL = MAINNET_MODE
    ? "https://id.ai/?feature_flag_guided_upgrade=true"
    : "http://localhost:9090/?canisterId=qhbym-qaaaa-aaaaa-aaafq-cai";
