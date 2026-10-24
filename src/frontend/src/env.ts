export const STAGING_MODE =
    process.env.DFX_NETWORK == "staging" ||
    process.env.DFX_NETWORK == "staging2";

export const MAINNET_MODE = STAGING_MODE || process.env.DFX_NETWORK == "ic";

export const CANISTER_ID = process.env.CANISTER_ID || "";
