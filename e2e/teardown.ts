import { ICManagementCanister } from "@dfinity/ic-management";
import { Principal } from "@dfinity/principal";
import { clearBuckets, createAgent, defaultIdentity } from "./support";

export default async function teardown(): Promise<void> {
    console.debug("\nRunning global teardown.");

    const agent = await createAgent(defaultIdentity);
    const managementCanister = ICManagementCanister.create({ agent });

    console.debug("Clearing storage buckets.");
    await clearBuckets();

    const canisterId = process.env["CANISTER_ID"];
    const principal = Principal.fromText(canisterId);

    console.debug("Stopping canister.");
    await managementCanister.stopCanister(principal);

    console.debug("Deleting canister.");
    await managementCanister.deleteCanister(principal);
}
