import { Principal } from "@dfinity/principal";
import { HttpAgent, polling } from "@dfinity/agent";
import { IDL } from '@dfinity/candid';
import { CANISTER_ID } from './env';

export const Api = (defaultCanisterId, identity, mainnetMode) => {
    defaultCanisterId = Principal.from(defaultCanisterId);
    const options = { identity };
    if (mainnetMode) options.host = `https://${CANISTER_ID}.ic0.app`;
    const agent = new HttpAgent(options);
    if (!mainnetMode) agent.fetchRootKey().catch(err=>{
        console.warn("Unable to fetch root key. Check to ensure that your local replica is running");
        console.error(err);
    });

    const query_raw = async (canisterId = defaultCanisterId, methodName, arg = Buffer.from([])) => {
        // console.debug(canisterId, defaultCanisterId, methodName, arg)
        let response = await agent.query(canisterId, { methodName, arg }, identity);
        if (response.status != "replied") {
            return console.error(status);
        }
        return response.reply.arg;
    };

    const query = async (methodName, arg0, arg1, arg2, arg3, arg4) => {
        let effParams = getEffParams([arg0, arg1, arg2, arg3, arg4]);
        const arg = Buffer.from(JSON.stringify(effParams));
        return JSON.parse(Buffer.from(await query_raw(undefined, methodName, arg)).toString('utf8'));
    }

    const call_raw = async (canisterId = defaultCanisterId, methodName, arg) => {
        let { response, requestId } = await agent.call(canisterId, { methodName, arg }, identity);
        if (!response.ok) {
            return console.error(`Call error: ${response.response.statusText}`);
        }
        return await polling.pollForResponse(agent, canisterId, requestId, polling.defaultStrategy);
    };

    const call = async (methodName, arg0, arg1, arg2, arg3, arg4, arg5) =>  {
        const effParams = getEffParams([arg0, arg1, arg2, arg3, arg4, arg5]);
        const responseBytes = await call_raw(undefined, methodName, Buffer.from(JSON.stringify(effParams)));
        if (responseBytes.byteLength)
            return JSON.parse(Buffer.from(responseBytes).toString('utf8'));
    };

    return { 
        query, query_raw, call, 
        set_emergency_release: async (blob) => {
            const arg = IDL.encode([IDL.Vec(IDL.Nat8)], [blob]);
            return IDL.decode([], await call_raw(undefined, "set_emergency_release", arg))[0];
        },
        propose_release: async (text, commit, blob) => {
            const arg = IDL.encode([IDL.Text, IDL.Text, IDL.Vec(IDL.Nat8)], [text, commit, blob]);
            return IDL.decode([IDL.Variant({ "Ok": IDL.Nat32, "Err": IDL.Text})], await call_raw(undefined, "propose_release", arg))[0];
        },
        add_post: async (text, blobs, parent, realm, extension) => {
            const arg = IDL.encode(
                [IDL.Text, IDL.Vec(IDL.Tuple(IDL.Text, IDL.Vec(IDL.Nat8))), IDL.Opt(IDL.Nat64), IDL.Opt(IDL.Text), IDL.Opt(IDL.Vec(IDL.Nat8))],
                [text, blobs, parent, realm, extension]
            );
            return IDL.decode([IDL.Variant({ "Ok": IDL.Nat64, "Err": IDL.Text})], await call_raw(undefined, "add_post", arg))[0];
        },
        edit_post: async (id, text, blobs, patch, realm) => {
            const arg = IDL.encode(
                [ IDL.Nat64, IDL.Text, IDL.Vec(IDL.Tuple(IDL.Text, IDL.Vec(IDL.Nat8))), IDL.Text, IDL.Opt(IDL.Text)],
                [id, text, blobs, patch, realm]
            );
            return IDL.decode([IDL.Variant({ "Ok": IDL.Null, "Err": IDL.Text})], await call_raw(undefined, "edit_post", arg))[0];
        },
        account_balance: async address => {
            const arg = IDL.encode([IDL.Record({ "account": IDL.Vec(IDL.Nat8) })], 
                [{ "account": hexToBytes(address) }]);
            return IDL.decode([IDL.Record({ "e8s": IDL.Nat64 })], 
                await query_raw(Principal.from("ryjl3-tyaaa-aaaaa-aaaba-cai"), "account_balance", arg))[0].e8s;
        },
    };
};

const getEffParams = args => {
    const values = args.filter(val => typeof val != "undefined");
    if (values.length == 0) return null;
    if (values.length == 1) {
        return values[0];
    }
    return values;
};

const hexToBytes = hex => {
    const bytes = [];
    for (let c = 0; c < hex.length; c += 2)
        bytes.push(parseInt(hex.substr(c, 2), 16));
    return Buffer.from(bytes);
}
