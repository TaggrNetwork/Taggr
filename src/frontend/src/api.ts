import { Principal } from "@dfinity/principal";
import { HttpAgent, HttpAgentOptions, Identity, polling } from "@dfinity/agent";
import { IDL, JsonValue } from "@dfinity/candid";
import { CANISTER_ID } from "./env";

export type Backend = {
    query: <T>(
        methodName: string,
        arg0?: unknown,
        arg1?: unknown,
        arg2?: unknown,
        arg3?: unknown,
        arg4?: unknown,
    ) => Promise<T | null>;

    query_raw: (
        canisterId: string,
        methodName: string,
        arg: ArrayBuffer,
    ) => Promise<ArrayBuffer | null>;

    call: <T>(
        methodName: string,
        arg0?: unknown,
        arg1?: unknown,
        arg2?: unknown,
        arg3?: unknown,
        arg4?: unknown,
        arg5?: unknown,
    ) => Promise<T | null>;

    set_emergency_release: (blob: Uint8Array) => Promise<JsonValue | null>;

    propose_release: (
        text: string,
        commit: string,
        blob: Uint8Array,
    ) => Promise<JsonValue | null>;

    add_post: (
        text: string,
        blobs: [string, Uint8Array][],
        parent?: number,
        realm?: string,
        extension?: Uint8Array,
    ) => Promise<JsonValue | null>;

    add_post_data: (
        text: string,
        realm?: string,
        extension?: Uint8Array,
    ) => Promise<null>;

    add_post_blob: (id: string, blob: Uint8Array) => Promise<JsonValue | null>;

    commit_post: () => Promise<JsonValue | null>;

    edit_post: (
        id: number,
        text: string,
        blobs: [string, Uint8Array][],
        patch: string,
        realm?: string,
    ) => Promise<JsonValue | null>;

    account_balance: (address: string) => Promise<number | null>;
};

export const ApiGenerator = (
    mainnetMode: boolean,
    defaultCanisterId: string,
    identity?: Identity,
): Backend => {
    let defaultPrincipal = Principal.fromText(defaultCanisterId);
    const options: HttpAgentOptions = { identity };
    if (mainnetMode) options.host = `https://${CANISTER_ID}.ic0.app`;
    const agent = new HttpAgent(options);
    if (!mainnetMode)
        agent.fetchRootKey().catch((err) => {
            console.warn(
                "Unable to fetch root key. Check to ensure that your local replica is running",
            );
            console.error(err);
        });

    const query_raw = async (
        canisterId = defaultCanisterId,
        methodName: string,
        arg = new ArrayBuffer(0),
    ): Promise<ArrayBuffer | null> => {
        let response = await agent.query(
            canisterId,
            { methodName, arg },
            identity,
        );
        if (response.status != "replied") {
            console.error(response);
            return null;
        }
        return response.reply.arg;
    };

    const query = async <T>(
        methodName: string,
        arg0?: unknown,
        arg1?: unknown,
        arg2?: unknown,
        arg3?: unknown,
        arg4?: unknown,
    ): Promise<T | null> => {
        let effParams = getEffParams([arg0, arg1, arg2, arg3, arg4]);
        const arg = Buffer.from(JSON.stringify(effParams));

        const response = await query_raw(undefined, methodName, arg);
        if (!response) {
            return null;
        }
        return JSON.parse(Buffer.from(response).toString("utf8"));
    };

    const call_raw = async (
        canisterId = defaultPrincipal,
        methodName: string,
        arg: ArrayBuffer,
    ): Promise<ArrayBuffer | null> => {
        let { response, requestId } = await agent.call(
            canisterId,
            { methodName, arg },
            identity,
        );
        if (!response.ok) {
            console.error(`Call error: ${response.statusText}`);
            return null;
        }
        return await polling.pollForResponse(
            agent,
            canisterId,
            requestId,
            polling.defaultStrategy(),
        );
    };

    const call = async <T>(
        methodName: string,
        arg0?: unknown,
        arg1?: unknown,
        arg2?: unknown,
        arg3?: unknown,
        arg4?: unknown,
        arg5?: unknown,
    ): Promise<T | null> => {
        const effParams = getEffParams([arg0, arg1, arg2, arg3, arg4, arg5]);
        const responseBytes = await call_raw(
            undefined,
            methodName,
            Buffer.from(JSON.stringify(effParams)),
        );
        if (!responseBytes || !responseBytes.byteLength) {
            return null;
        }
        return JSON.parse(Buffer.from(responseBytes).toString("utf8"));
    };

    return {
        query,
        query_raw,
        call,
        set_emergency_release: async (
            blob: Uint8Array,
        ): Promise<JsonValue | null> => {
            const arg = IDL.encode([IDL.Vec(IDL.Nat8)], [blob]);
            const response = await call_raw(
                undefined,
                "set_emergency_release",
                arg,
            );
            if (!response) {
                return null;
            }
            return IDL.decode([], response)[0];
        },
        propose_release: async (
            text: string,
            commit: string,
            blob: Uint8Array,
        ): Promise<JsonValue | null> => {
            const arg = IDL.encode(
                [IDL.Text, IDL.Text, IDL.Vec(IDL.Nat8)],
                [text, commit, blob],
            );
            const response = await call_raw(undefined, "propose_release", arg);
            if (!response) {
                return null;
            }
            return IDL.decode(
                [IDL.Variant({ Ok: IDL.Nat32, Err: IDL.Text })],
                response,
            )[0];
        },
        add_post: async (
            text: string,
            blobs: [string, Uint8Array][],
            parent?: number,
            realm?: string,
            extension?: Uint8Array,
        ): Promise<JsonValue | null> => {
            const arg = IDL.encode(
                [
                    IDL.Text,
                    IDL.Vec(IDL.Tuple(IDL.Text, IDL.Vec(IDL.Nat8))),
                    IDL.Opt(IDL.Nat64),
                    IDL.Opt(IDL.Text),
                    IDL.Opt(IDL.Vec(IDL.Nat8)),
                ],
                [text, blobs, parent, realm, extension],
            );
            const response = await call_raw(undefined, "add_post", arg);
            if (!response) {
                return null;
            }
            return IDL.decode(
                [IDL.Variant({ Ok: IDL.Nat64, Err: IDL.Text })],
                response,
            )[0];
        },
        add_post_data: async (
            text: string,
            realm?: string,
            extension?: Uint8Array,
        ): Promise<null> => {
            const arg = IDL.encode(
                [IDL.Text, IDL.Opt(IDL.Text), IDL.Opt(IDL.Vec(IDL.Nat8))],
                [text, realm, extension],
            );
            const response = await call_raw(undefined, "add_post_data", arg);
            if (!response) {
                return null;
            }
            return null;
        },
        add_post_blob: async (
            id: string,
            blob: Uint8Array,
        ): Promise<JsonValue | null> => {
            const arg = IDL.encode([IDL.Text, IDL.Vec(IDL.Nat8)], [id, blob]);
            const response = await call_raw(undefined, "add_post_blob", arg);
            if (!response) {
                return null;
            }
            return IDL.decode(
                [IDL.Variant({ Ok: IDL.Null, Err: IDL.Text })],
                response,
            )[0];
        },
        commit_post: async (): Promise<JsonValue | null> => {
            const arg = IDL.encode([], []);
            const response = await call_raw(undefined, "commit_post", arg);
            if (!response) {
                return null;
            }
            return IDL.decode(
                [IDL.Variant({ Ok: IDL.Nat64, Err: IDL.Text })],
                response,
            )[0];
        },
        edit_post: async (
            id: number,
            text: string,
            blobs: [string, Uint8Array][],
            patch: string,
            realm?: string,
        ): Promise<JsonValue | null> => {
            const arg = IDL.encode(
                [
                    IDL.Nat64,
                    IDL.Text,
                    IDL.Vec(IDL.Tuple(IDL.Text, IDL.Vec(IDL.Nat8))),
                    IDL.Text,
                    IDL.Opt(IDL.Text),
                ],
                [id, text, blobs, patch, realm],
            );
            const response = await call_raw(undefined, "edit_post", arg);
            if (!response) {
                return null;
            }
            return IDL.decode(
                [IDL.Variant({ Ok: IDL.Null, Err: IDL.Text })],
                response,
            )[0];
        },
        account_balance: async (address: string): Promise<number | null> => {
            const arg = IDL.encode(
                [IDL.Record({ account: IDL.Vec(IDL.Nat8) })],
                [{ account: hexToBytes(address) }],
            );
            const response = await query_raw(
                "ryjl3-tyaaa-aaaaa-aaaba-cai",
                "account_balance",
                arg,
            );

            if (!response) {
                return null;
            }
            return (
                IDL.decode([IDL.Record({ e8s: IDL.Nat64 })], response)[0] as any
            ).e8s;
        },
    };
};

const getEffParams = <T>(args: T[]): T | T[] | null => {
    const values = args.filter((val) => typeof val != "undefined");
    if (values.length == 0) return null;
    if (values.length == 1) {
        return values[0];
    }
    return values;
};

const hexToBytes = (hex: string): Buffer => {
    const bytes = [];
    for (let c = 0; c < hex.length; c += 2)
        bytes.push(parseInt(hex.slice(c, c + 2), 16));
    return Buffer.from(bytes);
};
