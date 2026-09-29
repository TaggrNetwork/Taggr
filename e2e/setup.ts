import { exec } from "./command";

// Resolved at worker startup from the environment that globalSetup populated.
export const canisterId = process.env["CANISTER_ID"] || "";

export default async function setup(): Promise<void> {
    console.debug("Global setup routine");

    const taggrId = exec("icp canister status taggr --id-only");

    exec(`icp canister call taggr reset '("${taggrId}")'`);
    exec("icp canister settings update taggr --add-controller " + taggrId);

    const status = JSON.parse(exec("icp network status --json"));
    const gatewayUrl = new URL(status.gateway_url || status.api_url);
    const port = gatewayUrl.port || "8000";
    const baseURL = `http://${taggrId}.localhost:${port}`;
    process.env["BASE_URL"] = baseURL;
    process.env["CANISTER_ID"] = taggrId;

    // add a timeout to allow canister to reset
    await new Promise((resolve) => setTimeout(resolve, 4000));
}
