import { LedgerCanister } from "@dfinity/nns";
import { Ed25519KeyIdentity } from "@dfinity/identity";
import { createAgent } from "./agent";

// static identity available with an ICP balance when installing NNS canisters with DFX,
// See: https://github.com/dfinity/sdk/blob/master/docs/cli-reference/dfx-nns.md
const publicKey = "Uu8wv55BKmk9ZErr6OIt5XR1kpEGXcOSOC1OYzrAwuk=";
const privateKey =
  "N3HB8Hh2PrWqhWH2Qqgr1vbU9T3gb1zgdBD8ZOdlQnVS7zC/nkEqaT1kSuvo4i3ldHWSkQZdw5I4LU5jOsDC6Q==";

function base64ToUInt8Array(base64String: string): Uint8Array {
  return Buffer.from(base64String, "base64");
}

const minting_identity = Ed25519KeyIdentity.fromKeyPair(
  base64ToUInt8Array(publicKey),
  base64ToUInt8Array(privateKey)
);

export async function createLedgerClient(baseUrl: string): Promise<LedgerCanister> {
  const agent = await createAgent(baseUrl, minting_identity);

  return LedgerCanister.create({
    agent,
  });
}
