export const MAINNET_MODE = process.env.DFX_NETWORK == "ic";

export const STAGING_MODE = process.env.DFX_NETWORK == "staging";

export const CANISTER_ID = process.env.CANISTER_ID || "";

export const II_URL =
    MAINNET_MODE || STAGING_MODE
        ? "https://identity.ic0.app"
        : "http://localhost:8080/?canisterId=qhbym-qaaaa-aaaaa-aaafq-cai";

export const II_DERIVATION_URL =
    MAINNET_MODE || STAGING_MODE
        ? `https://${CANISTER_ID}.ic0.app`
        : window.location.origin;
