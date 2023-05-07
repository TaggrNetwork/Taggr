import fetch from "isomorphic-fetch";
import { AnonymousIdentity, HttpAgent, Identity } from "@dfinity/agent";

export async function createAgent(
  host: string,
  identity: Identity = new AnonymousIdentity()
): Promise<HttpAgent> {
  const agent = new HttpAgent({
    identity,
    host,
    fetch,
  });

  await agent.fetchRootKey();

  return agent;
}
