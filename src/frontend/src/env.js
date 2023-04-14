export const MAINNET_MODE = process.env.NODE_ENV == "production";

export const CANISTER_ID = process.env.CANISTER_ID;

export const II_URL = MAINNET_MODE ? "https://identity.ic0.app" : "http://localhost:55554/?canisterId=qhbym-qaaaa-aaaaa-aaafq-cai";
export const II_DERIVATION_URL = MAINNET_MODE ? `https://${CANISTER_ID}.ic0.app` : window.location.origin;
