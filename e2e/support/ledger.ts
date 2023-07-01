import { LedgerCanister, SubAccount } from "@dfinity/nns";
import { Ed25519KeyIdentity } from "@dfinity/identity";
import { CMCCanister } from "@dfinity/cmc";
import { Principal } from "@dfinity/principal";
import { createAgent } from "./agent";
import { randomIntInRange } from "./random_data";

// static identity available with an ICP balance when installing NNS canisters with DFX,
// See: https://github.com/dfinity/sdk/blob/master/docs/cli-reference/dfx-nns.md
const publicKey = "Uu8wv55BKmk9ZErr6OIt5XR1kpEGXcOSOC1OYzrAwuk=";
const privateKey =
    "N3HB8Hh2PrWqhWH2Qqgr1vbU9T3gb1zgdBD8ZOdlQnVS7zC/nkEqaT1kSuvo4i3ldHWSkQZdw5I4LU5jOsDC6Q==";

function base64ToUInt8Array(base64String: string): Uint8Array {
    return Buffer.from(base64String, "base64");
}

const mintingIdentity = Ed25519KeyIdentity.fromKeyPair(
    base64ToUInt8Array(publicKey),
    base64ToUInt8Array(privateKey)
);

export const mintingPrincipal = mintingIdentity.getPrincipal();

export function generateSubAccount(): SubAccount {
    const id = randomIntInRange(1, 255);

    return SubAccount.fromID(id);
}

export async function createLedgerClient(): Promise<LedgerCanister> {
    const agent = await createAgent(mintingIdentity);

    return LedgerCanister.create({
        agent,
    });
}

export async function icpToTaggrCyclesRate(): Promise<bigint> {
    const agent = await createAgent();

    const cyclesMintingCanister = CMCCanister.create({
        agent,
        canisterId: Principal.fromUint8Array(
            new Uint8Array([
                0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x04, 0x01, 0x01,
            ])
        ),
    });

    const cyclesConversionRate =
        await cyclesMintingCanister.getIcpToCyclesConversionRate();

    return (BigInt(100_000_000) / cyclesConversionRate) * BigInt(10_000);
}
