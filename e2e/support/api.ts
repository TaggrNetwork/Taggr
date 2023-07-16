import { HttpAgent, polling } from "@dfinity/agent";
import { Principal } from "@dfinity/principal";
import { IDL } from "@dfinity/candid";
import { createAgent } from "./agent";

const canisterId = process.env["CANISTER_ID"];

async function call(
    agent: HttpAgent,
    methodName: string,
    arg: ArrayBuffer,
): Promise<void> {
    let { requestId } = await agent.call(canisterId, {
        methodName,
        arg,
    });
    await polling.pollForResponse(
        agent,
        Principal.fromText(canisterId),
        requestId,
        polling.defaultStrategy(),
    );
}

export async function godMode(username: string): Promise<void> {
    const agent = await createAgent();
    const arg = IDL.encode([IDL.Text], [username]);
    await call(agent, "godmode", arg);
}

export async function demiGodMode(username: string): Promise<void> {
    const agent = await createAgent();
    const arg = IDL.encode([IDL.Text], [username]);
    await call(agent, "demigodmode", arg);
}

export async function peasantMode(username: string): Promise<void> {
    const agent = await createAgent();
    const arg = IDL.encode([IDL.Text], [username]);
    await call(agent, "peasantmode", arg);
}
