import { exec } from "./command";

export const canisterId = "uxrrr-q7777-77774-qaaaq-cai";

export default async function setup(): Promise<void> {
    console.debug("Global setup routine");

    exec("dfx canister update-settings taggr --add-controller " + canisterId);
    exec(`dfx canister call taggr reset '("${canisterId}")'`);

    const webServerPort = exec("dfx info webserver-port");
    const baseURL = `http://${canisterId}.localhost:${webServerPort}`;
    process.env["BASE_URL"] = baseURL;
}
