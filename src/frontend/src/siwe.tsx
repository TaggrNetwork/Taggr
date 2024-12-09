import * as React from "react";
import { ButtonWithLoading, hash, restartApp, signOut } from "./common";
import { Globe } from "./icons";
import { Ed25519KeyIdentity } from "@dfinity/identity";
import { ApiGenerator } from "./api";
import { MAINNET_MODE } from "./env";

export const SignWithEthereum = ({}) => {
    let delegateIdentity: Ed25519KeyIdentity | null = null;

    // Creates a session nonce for the delegator using the delegate identity.
    const getNonce = async () => {
        if (!delegateIdentity) throw Error("getNonce: no delegate identity");
        return delegateIdentity?.getPrincipal().toString().replaceAll("-", "");
    };

    const verifyMessage = async ({
        message,
        signature,
    }: {
        message: string;
        signature: string;
    }) => {
        if (!delegateIdentity) throw Error("verify: no delegate identity");
        const api = ApiGenerator(MAINNET_MODE, delegateIdentity);
        const response: any = await api.call(
            "siwe_session",
            message,
            signature,
        );
        if ("Ok" in response) {
            localStorage.setItem("delegator", response.Ok);
            localStorage.setItem(
                "IDENTITY",
                JSON.stringify(delegateIdentity.toJSON()),
            );
            return true;
        }
        alert(`Error: ${response.Err}`);
        signOut();
        return false;
    };

    React.useEffect(() => {
        if ("siweModal" in window) return;
        const script = document.createElement("script");
        script.src = "/siwe.js";
        document.body.appendChild(script);
    }, []);

    return (
        <ButtonWithLoading
            onClick={async () => {
                if (!delegateIdentity) {
                    const randomBytes = new Uint8Array(32);
                    window.crypto.getRandomValues(randomBytes);
                    const seed = Array.from(randomBytes)
                        .map((b) => b.toString(16).padStart(2, "0"))
                        .join("");
                    delegateIdentity = Ed25519KeyIdentity.generate(
                        await hash(seed, 1),
                    );
                }
                const { name, siwe_statement } = window.backendCache.config;

                if ("siweModal" in window)
                    // @ts-ignore
                    await window.siweModal({
                        name,
                        statement: siwe_statement,
                        getNonce,
                        verifyMessage,
                        onSignIn: restartApp,
                        signOut,
                    });
            }}
            classNameArg="active large_text vertically_spaced left_spaced right_spaced"
            label={
                <>
                    <Globe /> Sign With Ethereum
                </>
            }
        />
    );
};
