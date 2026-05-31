import { Principal } from "@dfinity/principal";
import {
    Certificate,
    HttpAgent,
    HttpAgentOptions,
    Identity,
    lookupResultToBuffer,
    polling,
} from "@dfinity/agent";
import { bufFromBufLike, IDL, JsonValue } from "@dfinity/candid";
import { CANISTER_ID } from "./env";
import { ICP_DEFAULT_FEE, ICP_LEDGER_ID } from "./common";
import {
    IcrcLedgerCanister,
    IcrcTransferError,
    IcrcAccount,
    IcrcMetadataResponseEntries,
} from "@dfinity/ledger-icrc";
import { Value } from "@dfinity/ledger-icrc/dist/candid/icrc_ledger";
import { Icrc1Canister, PostId } from "./types";

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

    call_raw: (
        canisterId: Principal,
        methodName: string,
        arg: ArrayBuffer,
        effectiveCanisterId?: Principal,
    ) => Promise<ArrayBuffer | null>;

    call: <T>(
        methodName: string,
        arg0?: unknown,
        arg1?: unknown,
        arg2?: unknown,
        arg3?: unknown,
        arg4?: unknown,
        arg5?: unknown,
        arg6?: unknown,
        arg7?: unknown,
        arg8?: unknown,
    ) => Promise<T | null>;

    set_emergency_release: (blob: Uint8Array) => Promise<JsonValue | null>;

    unlink_cold_wallet: () => Promise<JsonValue | null>;

    propose_release: (
        postId: PostId,
        commit: string,
        blob: Uint8Array,
    ) => Promise<JsonValue | null>;

    add_post: (
        text: string,
        refs: [string, number, number][],
        parent: number[],
        realm: string[],
        extension: Uint8Array[],
    ) => Promise<JsonValue | null>;

    edit_post: (
        id: number,
        text: string,
        refs: [string, number, number][],
        patch: string,
        realm: string[],
    ) => Promise<JsonValue | null>;

    bucket_write: (bucket: Principal, blob: Uint8Array) => Promise<bigint>;

    bucket_free: (
        bucket: Principal,
        segments: [bigint, bigint][],
    ) => Promise<void>;

    add_bucket_controller: (
        bucket: Principal,
        existing: Principal[],
        added: Principal,
    ) => Promise<void>;

    icp_account_balance: (address: string) => Promise<BigInt>;

    account_balance: (
        token: Principal,
        account: IcrcAccount,
    ) => Promise<bigint>;

    icp_transfer: (
        account: string,
        e8s: number,
        memo?: number,
    ) => Promise<JsonValue>;

    icrc_transfer: (
        token: Principal,
        recipient: Principal,
        amount: number,
        fee: number,
        memo?: any,
    ) => Promise<string | number>;

    icrc_metadata: (canisterId: string) => Promise<Icrc1Canister | null>;
};

export const ApiGenerator = (
    mainnetMode: boolean,
    identity?: Identity,
): Backend => {
    const defaultPrincipal = Principal.fromText(CANISTER_ID);
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

    const agentCache: Map<string, IcrcLedgerCanister> = new Map();
    const getIcrcCanister = (canisterId: string) => {
        const canisterAgent = agentCache.get(canisterId);
        if (canisterAgent) {
            return canisterAgent;
        }
        const canister = IcrcLedgerCanister.create({
            canisterId: Principal.from(canisterId),
            agent,
        });
        agentCache.set(canisterId, canister);
        return canister;
    };

    const query_raw = async (
        canisterId = CANISTER_ID,
        methodName: string,
        arg = new ArrayBuffer(0),
    ): Promise<ArrayBuffer | null> => {
        try {
            let response = await agent.query(
                canisterId,
                { methodName, arg },
                identity,
            );
            if (response.status != "replied") {
                console.error(methodName, response);
                return null;
            }

            return response.reply.arg;
        } catch (error) {
            console.error(error);
            return null;
        }
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
        const arg = new TextEncoder().encode(JSON.stringify(effParams))
            .buffer as ArrayBuffer;

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
        effectiveCanisterId?: Principal,
    ): Promise<ArrayBuffer | null> => {
        try {
            let { response, requestId } = await agent.call(
                canisterId,
                { methodName, arg, callSync: true, effectiveCanisterId },
                identity,
            );
            if (!response.ok) {
                console.error(`Call error: ${response.statusText}`);
                return null;
            }

            let certificate: Certificate | undefined;
            if (response.body && "certificate" in response.body) {
                const cert = response.body.certificate;
                certificate = await Certificate.create({
                    certificate: bufFromBufLike(cert),
                    rootKey: agent.rootKey || new ArrayBuffer(0),
                    canisterId: Principal.from(canisterId),
                });
                const path = [
                    new TextEncoder().encode("request_status"),
                    requestId,
                ];
                const status = new TextDecoder().decode(
                    lookupResultToBuffer(
                        // @ts-ignore
                        certificate.lookup([...path, "status"]),
                    ),
                );

                switch (status) {
                    case "replied":
                        return (
                            lookupResultToBuffer(
                                // @ts-ignore
                                certificate.lookup([...path, "reply"]),
                            ) || null
                        );
                    case "rejected":
                        console.error(
                            `Call rejected: ${response.statusText}; falling back to polling...`,
                        );
                }
            }

            return (
                await polling.pollForResponse(
                    agent,
                    canisterId,
                    requestId,
                    polling.defaultStrategy(),
                )
            ).reply;
        } catch (error) {
            console.error(error);
            return null;
        }
    };

    const call = async <T>(
        methodName: string,
        arg0?: unknown,
        arg1?: unknown,
        arg2?: unknown,
        arg3?: unknown,
        arg4?: unknown,
        arg5?: unknown,
        arg6?: unknown,
        arg7?: unknown,
        arg8?: unknown,
    ): Promise<T | null> => {
        const effParams = getEffParams([
            arg0,
            arg1,
            arg2,
            arg3,
            arg4,
            arg5,
            arg6,
            arg7,
            arg8,
        ]);
        const responseBytes = await call_raw(
            undefined,
            methodName,
            new TextEncoder().encode(JSON.stringify(effParams))
                .buffer as ArrayBuffer,
        );
        if (!responseBytes || !responseBytes.byteLength) {
            return null;
        }
        return JSON.parse(Buffer.from(responseBytes).toString("utf8"));
    };

    return {
        query,
        query_raw,
        call_raw,
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

        unlink_cold_wallet: async (): Promise<JsonValue | null> => {
            const arg = IDL.encode([], []);
            let response = await call_raw(undefined, "unlink_cold_wallet", arg);
            if (!response) {
                return null;
            }
            return IDL.decode(
                [IDL.Variant({ Ok: IDL.Null, Err: IDL.Text })],
                response,
            )[0];
        },

        propose_release: async (
            postId: PostId,
            commit: string,
            blob: Uint8Array,
        ): Promise<JsonValue | null> => {
            const arg = IDL.encode(
                [IDL.Nat64, IDL.Text, IDL.Vec(IDL.Nat8)],
                [postId, commit, blob],
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
            refs: [string, number, number][],
            parent: number[],
            realm: string[],
            extension: Uint8Array[],
        ): Promise<JsonValue | null> => {
            const arg = IDL.encode(
                [
                    IDL.Text,
                    IDL.Vec(IDL.Tuple(IDL.Text, IDL.Nat64, IDL.Nat64)),
                    IDL.Opt(IDL.Nat64),
                    IDL.Opt(IDL.Text),
                    IDL.Opt(IDL.Vec(IDL.Nat8)),
                ],
                [text, refs, parent, realm, extension],
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
        bucket_write: async (
            bucket: Principal,
            blob: Uint8Array,
        ): Promise<bigint> => {
            // Bucket `write` takes raw bytes and replies with the 8-byte
            // big-endian offset where the blob was stored.
            const buf = await call_raw(
                bucket,
                "write",
                blob.buffer.slice(
                    blob.byteOffset,
                    blob.byteOffset + blob.byteLength,
                ) as ArrayBuffer,
            );
            if (!buf || buf.byteLength < 8) {
                throw new Error("bucket.write: short reply");
            }
            return new DataView(buf).getBigUint64(0, false);
        },
        bucket_free: async (
            bucket: Principal,
            segments: [bigint, bigint][],
        ): Promise<void> => {
            if (segments.length === 0) return;
            const arg = IDL.encode(
                [IDL.Vec(IDL.Tuple(IDL.Nat64, IDL.Nat64))],
                [segments],
            );
            await call_raw(bucket, "free", arg);
        },
        add_bucket_controller: async (
            bucket: Principal,
            existing: Principal[],
            added: Principal,
        ): Promise<void> => {
            const controllers = [
                ...existing.filter((p) => p.toText() !== added.toText()),
                added,
            ];
            const CanisterSettings = IDL.Record({
                controllers: IDL.Opt(IDL.Vec(IDL.Principal)),
                compute_allocation: IDL.Opt(IDL.Nat),
                memory_allocation: IDL.Opt(IDL.Nat),
                freezing_threshold: IDL.Opt(IDL.Nat),
                reserved_cycles_limit: IDL.Opt(IDL.Nat),
                log_visibility: IDL.Opt(
                    IDL.Variant({
                        controllers: IDL.Null,
                        public: IDL.Null,
                    }),
                ),
                wasm_memory_limit: IDL.Opt(IDL.Nat),
                wasm_memory_threshold: IDL.Opt(IDL.Nat),
            });
            const UpdateSettingsArgs = IDL.Record({
                canister_id: IDL.Principal,
                settings: CanisterSettings,
                sender_canister_version: IDL.Opt(IDL.Nat64),
            });
            const mgmtArg = IDL.encode(
                [UpdateSettingsArgs],
                [
                    {
                        canister_id: bucket,
                        settings: {
                            controllers: [controllers],
                            compute_allocation: [],
                            memory_allocation: [],
                            freezing_threshold: [],
                            reserved_cycles_limit: [],
                            log_visibility: [],
                            wasm_memory_limit: [],
                            wasm_memory_threshold: [],
                        },
                        sender_canister_version: [],
                    },
                ],
            );
            const mgmtResult = await call_raw(
                Principal.fromText("aaaaa-aa"),
                "update_settings",
                mgmtArg,
                bucket,
            );
            if (mgmtResult === null) {
                throw new Error(
                    "IC management update_settings failed (see console)",
                );
            }
            const internalArg = IDL.encode(
                [IDL.Vec(IDL.Principal)],
                [controllers],
            );
            const internalResult = await call_raw(
                bucket,
                "update_internal_controllers",
                internalArg,
            );
            if (internalResult === null) {
                throw new Error(
                    "bucket.update_internal_controllers failed (see console)",
                );
            }
            // Read the management controllers back and assert the new principal
            // is present before the caller proceeds; otherwise a silently
            // mis-applied update would still let the principal change go ahead
            // and strip the user of all control over the canister.
            const StatusResult = IDL.Record({
                settings: IDL.Record({
                    controllers: IDL.Vec(IDL.Principal),
                }),
            });
            const statusArg = IDL.encode(
                [IDL.Record({ canister_id: IDL.Principal })],
                [{ canister_id: bucket }],
            );
            const statusBuf = await call_raw(
                Principal.fromText("aaaaa-aa"),
                "canister_status",
                statusArg,
                bucket,
            );
            if (statusBuf === null) {
                throw new Error(
                    "IC management canister_status failed (see console)",
                );
            }
            const { settings } = IDL.decode(
                [StatusResult],
                statusBuf,
            )[0] as any;
            if (
                !settings.controllers.some(
                    (p: Principal) => p.toText() === added.toText(),
                )
            ) {
                throw new Error(
                    "new principal not found in bucket controllers after update",
                );
            }
        },
        edit_post: async (
            id: number,
            text: string,
            refs: [string, number, number][],
            patch: string,
            realm: string[],
        ): Promise<JsonValue | null> => {
            const arg = IDL.encode(
                [
                    IDL.Nat64,
                    IDL.Text,
                    IDL.Vec(IDL.Tuple(IDL.Text, IDL.Nat64, IDL.Nat64)),
                    IDL.Text,
                    IDL.Opt(IDL.Text),
                ],
                [id, text, refs, patch, realm],
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

        icp_account_balance: async (address: string): Promise<BigInt> => {
            const arg = IDL.encode(
                [IDL.Record({ account: IDL.Vec(IDL.Nat8) })],
                [{ account: hexToBytes(address) }],
            );
            const response = await query_raw(
                ICP_LEDGER_ID.toString(),
                "account_balance",
                arg,
            );

            if (!response) {
                return BigInt(-1);
            }
            return (
                IDL.decode([IDL.Record({ e8s: IDL.Nat64 })], response)[0] as any
            ).e8s;
        },

        icrc_transfer: async (
            token: Principal,
            recipient: Principal,
            amount: number,
            fee: number,
            memo?: Uint8Array,
        ) => {
            try {
                const canister = IcrcLedgerCanister.create({
                    canisterId: Principal.from(token),
                    agent,
                });
                const response = await canister.transfer({
                    to: { owner: recipient, subaccount: [] },
                    amount: BigInt(amount),
                    fee: BigInt(fee),
                    memo: memo as any,
                });

                return response.toString(); // Response is index of transaction
            } catch (e) {
                let err = e as unknown as IcrcTransferError<string>;
                return err.message;
            }
        },

        icp_transfer: async (account: string, e8s: number, memo = 0) => {
            const arg = IDL.encode(
                [
                    IDL.Record({
                        to: IDL.Vec(IDL.Nat8),
                        amount: IDL.Record({ e8s: IDL.Nat64 }),
                        fee: IDL.Record({ e8s: IDL.Nat64 }),
                        memo: IDL.Nat64,
                    }),
                ],
                [
                    {
                        to: hexToBytes(account),
                        amount: { e8s },
                        fee: { e8s: ICP_DEFAULT_FEE },
                        memo,
                    },
                ],
            );
            const response = await call_raw(ICP_LEDGER_ID, "transfer", arg);
            if (!response) {
                return null;
            }
            return IDL.decode(
                [IDL.Variant({ Ok: IDL.Nat64, Err: IDL.Unknown })],
                response,
            )[0] as any;
        },

        account_balance: async (
            token: Principal,
            account: IcrcAccount,
        ): Promise<bigint> => {
            const canister = getIcrcCanister(token.toString());
            return await canister.balance({
                certified: false,
                owner: account.owner,
                subaccount: account.subaccount,
            });
        },

        icrc_metadata: async (canisterId: string) => {
            const canister = getIcrcCanister(canisterId);
            const meta = await canister.metadata({
                certified: false,
            });

            const m = new Map<IcrcMetadataResponseEntries, Value>(meta as any);

            return {
                decimals: new Number(
                    (m.get(IcrcMetadataResponseEntries.DECIMALS) as any).Nat,
                ).valueOf(),
                fee: new Number(
                    (m.get(IcrcMetadataResponseEntries.FEE) as any).Nat,
                ).valueOf(),
                logo: (m.get(IcrcMetadataResponseEntries.LOGO) as any)?.Text,
                name: (m.get(IcrcMetadataResponseEntries.NAME) as any).Text,
                symbol: (m.get(IcrcMetadataResponseEntries.SYMBOL) as any).Text,
            };
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
