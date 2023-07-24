import { ICManagementCanister, InstallMode } from "@dfinity/ic-management";
import { Principal } from "@dfinity/principal";
import {
    clearBuckets,
    createAgent,
    defaultIdentity,
    exec,
    loadWasm,
} from "./support";

export default async function setup(): Promise<void> {
    console.debug("Running global setup.");

    const replicaPort = exec("dfx info replica-port");
    process.env["REPLICA_URL"] = `http://localhost:${replicaPort}`;

    const agent = await createAgent(defaultIdentity);
    const managementCanister = ICManagementCanister.create({ agent });

    const canisterId = Principal.fromText("6nxqb-aaaae-bqibi-ga4ea-scq");
    process.env["CANISTER_ID"] = canisterId.toText();

    console.debug("Creating canister.");
    try {
        await managementCanister.provisionalCreateCanisterWithCycles({
            canisterId,
        });
    } catch (error) {
        console.debug("Canister already created, continuing.");
    }

    const wasmModule = loadWasm();
    try {
        console.debug("Installing wasm.");
        await managementCanister.installCode({
            mode: InstallMode.Install,
            canisterId,
            wasmModule,
            arg: new Uint8Array(),
        });
    } catch (error) {
        console.debug("Wasm already installed, reinstalling.");
        await managementCanister.installCode({
            mode: InstallMode.Reinstall,
            canisterId,
            wasmModule,
            arg: new Uint8Array(),
        });

        console.debug("Clearing storage buckets.");
        await clearBuckets();
    }

    const webServerPort = exec("dfx info webserver-port");
    const baseURL = `http://${canisterId}.localhost:${webServerPort}`;
    process.env["BASE_URL"] = baseURL;
}
