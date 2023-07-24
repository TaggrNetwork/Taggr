import fetch from "isomorphic-fetch";
import { AnonymousIdentity, HttpAgent, Identity } from "@dfinity/agent";
import { Ed25519KeyIdentity } from "@dfinity/identity";
import { createHash } from "node:crypto";

const hash = createHash("sha256");
hash.update("super-secret-password");
const digest = hash.digest("hex");

export const defaultIdentity = Ed25519KeyIdentity.generate(
    new TextEncoder().encode(digest).slice(0, 32),
);

export async function createAgent(
    identity: Identity = new AnonymousIdentity(),
): Promise<HttpAgent> {
    const agent = new HttpAgent({
        identity,
        host: process.env["REPLICA_URL"],
        fetch,
    });

    await agent.fetchRootKey();

    return agent;
}
