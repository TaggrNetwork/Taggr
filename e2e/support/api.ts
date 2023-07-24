import { HttpAgent, polling } from "@dfinity/agent";
import { Principal } from "@dfinity/principal";
import { IDL } from "@dfinity/candid";
import { createAgent } from "./agent";

async function call(
    agent: HttpAgent,
    methodName: string,
    arg: ArrayBuffer = IDL.encode([], []),
): Promise<void> {
    const canisterId = process.env["CANISTER_ID"];
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

async function query<T>(
    agent: HttpAgent,
    methodName: string,
    arg: ArrayBuffer = IDL.encode([], []),
): Promise<T> {
    const canisterId = process.env["CANISTER_ID"];
    let response = await agent.query(canisterId, { methodName, arg });

    if (response.status != "replied") {
        console.error(response.status);
        return null;
    }

    return JSON.parse(Buffer.from(response.reply.arg).toString("utf8"));
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

export async function clearBuckets(): Promise<void> {
    const agent = await createAgent();
    await call(agent, "clear_buckets");
}
