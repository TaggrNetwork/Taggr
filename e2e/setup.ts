import { exec } from "./command";

export const canisterId = "uxrrr-q7777-77774-qaaaq-cai";

export default async function setup(): Promise<void> {
    console.debug("Global setup routine");

    exec(`dfx canister call taggr reset '("${canisterId}")'`);
    exec("dfx canister update-settings taggr --add-controller " + canisterId);

    // CMC stub for the bucket-creation e2e flow. Deploys once; fabricates a
    // generous cycle balance so each test's bucket creation has cycles to
    // spawn the new canister.
    exec("dfx deploy cmc_stub --yes");
    exec(
        "dfx ledger fabricate-cycles --canister cmc_stub --t 100",
    );

    const webServerPort = exec("dfx info webserver-port");
    const baseURL = `http://${canisterId}.localhost:${webServerPort}`;
    process.env["BASE_URL"] = baseURL;

    // add a timeout to allow canister to reset
    await new Promise((resolve) => setTimeout(resolve, 4000));
}
