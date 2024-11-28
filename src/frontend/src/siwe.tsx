import { SiweMessage } from "siwe";
import {
    createIdentityFromSeed,
    instantiateApiFromIdentity,
    logout,
} from "./common";
import { Principal } from "@dfinity/principal";

const scheme = window.location.protocol.slice(0, -1);
const domain = window.location.host;
const origin = window.location.origin;

export function createSiweMessage(
    address: string,
    statement: string,
    nonce: string,
) {
    const message = new SiweMessage({
        scheme,
        nonce,
        domain,
        address,
        statement,
        uri: origin,
        version: "1",
        chainId: 1,
    });
    return message.prepareMessage();
}

// Creates a session nonce for the delegator using delegate identity.
export const getNonce = async (address: string) => {
    const randomBytes = new Uint8Array(32); // 256 bits of entropy
    window.crypto.getRandomValues(randomBytes);
    const seed = Array.from(randomBytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    const delegateIdentity = await createIdentityFromSeed(
        "WALLET_CONNECT",
        seed,
    );
    instantiateApiFromIdentity(delegateIdentity);
    const delegator = address
        ? Principal.fromHex(address)
        : Principal.anonymous();
    localStorage.setItem("delegator", delegator.toString());
    return (
        (await window.api.call<string>("siwe_nonce", delegator.toString())) ||
        ""
    );
};

export const verifyMessage = async (message: string, signature: string) => {
    const response: any = await window.api.call(
        "siwe_verify_message",
        message,
        signature,
    );
    if ("Ok" in response) {
        location.reload();
        return true;
    }
    alert(`Error: ${response.Err}`);
    logout();
    return false;
};
