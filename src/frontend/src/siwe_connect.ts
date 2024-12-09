import {
    type SIWECreateMessageArgs,
    createSIWEConfig,
    formatMessage,
} from "@reown/appkit-siwe";
import { mainnet } from "@reown/appkit/networks";
import { createAppKit } from "@reown/appkit";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";

const projectId = "d4f461cc66e814f25f08579c747def31";

// @ts-ignore
window.siweModal = async ({
    name,
    statement,
    getNonce,
    verifyMessage,
    signOut,
    onSignIn,
}: {
    name: string;
    statement: string;
    getNonce: () => Promise<string>;
    onSignIn: () => Promise<void>;
    signOut: () => Promise<boolean>;
    verifyMessage: ({
        message,
        signature,
    }: {
        message: string;
        signature: string;
    }) => Promise<boolean>;
}) => {
    const siweConfig = createSIWEConfig({
        getMessageParams: async () => ({
            domain: window.location.host,
            uri: window.location.origin,
            chains: [mainnet.id],
            statement,
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
        onSignIn,
    });

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
            name,
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

    modal.open();
};
