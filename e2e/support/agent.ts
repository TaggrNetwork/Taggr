import fetch from "isomorphic-fetch";
import { AnonymousIdentity, HttpAgent, Identity } from "@dfinity/agent";

export async function createAgent(
  identity: Identity = new AnonymousIdentity()
): Promise<HttpAgent> {
  const agent = new HttpAgent({
    identity,
    host: process.env["REPLICA_URL"],
    fetch,
  });

  await agent.fetchRootKey();

  return agent;
}
