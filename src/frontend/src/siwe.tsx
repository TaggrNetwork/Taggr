import {
    SIWEProvider,
    SIWEConfig,
    ConnectKitProvider,
    getDefaultConfig,
    useSIWE,
    useModal,
} from "connectkit";
import { mainnet } from "wagmi/chains";
import { WagmiProvider, createConfig } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SiweMessage } from "siwe";
import {
    ButtonWithLoading,
    hash,
    instantiateApiFromIdentity,
    signOut,
} from "./common";
import { Address } from "viem";
import { Globe } from "./icons";
import { Ed25519KeyIdentity } from "@dfinity/identity";
import { ApiGenerator } from "./api";
import { MAINNET_MODE } from "./env";

let delegateIdentity: Ed25519KeyIdentity | null = null;

export function createMessage({
    address,
    chainId,
    nonce,
}: {
    nonce: string;
    address: Address;
    chainId: number;
}) {
    const message = new SiweMessage({
        nonce,
        address,
        statement: window.backendCache.config.siwe_statement,
        uri: origin,
        domain: window.location.host,
        chainId,
        version: "1",
    });
    return message.prepareMessage();
}

// Creates a session nonce for the delegator using the delegate identity.
export const getNonce = async () => {
    if (!delegateIdentity) throw Error("getNonce: no delegate identity");
    return delegateIdentity?.getPrincipal().toString().replaceAll("-", "");
};

export const verifyMessage = async ({
    message,
    signature,
}: {
    message: string;
    signature: string;
}) => {
    if (!delegateIdentity) throw Error("verifyMessage: no delegate identity");
    const api = ApiGenerator(MAINNET_MODE, delegateIdentity);
    const response: any = await api.call("siwe_session", message, signature);
    if ("Ok" in response) {
        localStorage.setItem("delegator", response.Ok);
        instantiateApiFromIdentity(delegateIdentity);
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

export const SignWithEthereum = ({}) => {
    const siweConfig: SIWEConfig = {
        getNonce,
        createMessage,
        verifyMessage,
        getSession: async () => null,
        signOut,
    };
    const queryClient = new QueryClient();

    const config = createConfig(
        getDefaultConfig({
            appName: window.backendCache.config.name,
            appDescription: "Decentralized Social Network",
            appUrl: window.location.origin,
            appIcon:
                "https://6qfxa-ryaaa-aaaai-qbhsq-cai.raw.ic0.app/_/raw/apple-touch-icon.png",

            chains: [mainnet],

            coinbaseWalletPreference: "eoaOnly",

            walletConnectProjectId: "d4f461cc66e814f25f08579c747def31",
        }),
    );

    return (
        <WagmiProvider config={config}>
            <QueryClientProvider client={queryClient}>
                <SIWEProvider {...siweConfig}>
                    <ConnectKitProvider>
                        <Button />
                    </ConnectKitProvider>
                </SIWEProvider>
            </QueryClientProvider>
        </WagmiProvider>
    );
};

const Button = ({}) => {
    const {} = useSIWE({
        onSignIn: () => {
            throw Error("signed in!");
        },
    });
    const { setOpen } = useModal();
    return (
        <ButtonWithLoading
            onClick={async () => {
                if (!delegateIdentity) {
                    console.log("create delegation");
                    const randomBytes = new Uint8Array(32);
                    window.crypto.getRandomValues(randomBytes);
                    const seed = Array.from(randomBytes)
                        .map((b) => b.toString(16).padStart(2, "0"))
                        .join("");
                    delegateIdentity = Ed25519KeyIdentity.generate(
                        await hash(seed, 1),
                    );
                }

                // if (isConnected) signIn({ address, chainId: mainnet.id });
                setOpen(true);
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
