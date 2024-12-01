import {
    type SIWECreateMessageArgs,
    createSIWEConfig,
    formatMessage,
} from "@reown/appkit-siwe";
import { createAppKit } from "@reown/appkit";
import { mainnet } from "@reown/appkit/networks";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import {
    ButtonWithLoading,
    hash,
    instantiateApiFromIdentity,
    restartApp,
    signOut,
} from "./common";
import { Globe } from "./icons";
import { Ed25519KeyIdentity } from "@dfinity/identity";
import { ApiGenerator } from "./api";
import { MAINNET_MODE } from "./env";

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
    const siweConfig = createSIWEConfig({
        getMessageParams: async () => ({
            domain: window.location.host,
            uri: window.location.origin,
            chains: [mainnet.id],
            statement: window.backendCache.config.siwe_statement,
            resources: [
                "urn:recap:eyJhdHQiOnsiZWlwMTU1Ijp7InJlcXVlc3QvZXRoX3NpZ25UeXBlZERhdGFfdjQiOlt7fV0sInJlcXVlc3QvcGVyc29uYWxfc2lnbiI6W3t9XX19fQ==",
            ],
        }),
        createMessage: ({ address, ...args }: SIWECreateMessageArgs) =>
            formatMessage(args, address),

        getNonce,
        getSession: async () => null,
        verifyMessage,
        signOut,
        onSignIn: restartApp,
    });

    const projectId = "d4f461cc66e814f25f08579c747def31";

    const modal = createAppKit({
        adapters: [
            new WagmiAdapter({
                projectId,
                networks: [mainnet],
            }),
        ],
        projectId,
        networks: [mainnet],
        defaultNetwork: mainnet,
        siweConfig,
        metadata: {
            name: window.backendCache.config.name,
            description: "Decentralized Social Network",
            url: window.location.origin,
            icons: [
                "https://6qfxa-ryaaa-aaaai-qbhsq-cai.raw.ic0.app/_/raw/apple-touch-icon.png",
            ],
        },
        features: {
            legalCheckbox: false,
            email: false,
            socials: [],
            emailShowWallets: false,
            onramp: false,
            swaps: false,
        },
        coinbasePreference: "eoaOnly",
        featuredWalletIds: [
            "ecc4036f814562b41a5268adc86270fba1365471402006302e70169465b7ac18",
            "fd20dc426fb37566d803205b19bbc1d4096b248ac04548e3cfb6b3a38bd033aa",
            "c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96",
        ],
    });

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
                await modal.open();
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
