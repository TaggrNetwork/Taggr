import { defineConfig, devices } from "@playwright/test";
import { execSync } from "node:child_process";

function exec(cmd: string): string {
    const result = execSync(cmd);

    return result.toString().replace(/(\r\n|\n|\r)/gm, "");
}

const canisterId = exec("dfx canister id taggr");
const webServerPort = exec("dfx info webserver-port");
const replicaPort = exec("dfx info replica-port");

process.env["REPLICA_URL"] = `http://localhost:${replicaPort}`;
process.env["CANISTER_ID"] = canisterId;

export default defineConfig({
    testDir: "./e2e",
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: [
        ["list", { printSteps: true }],
        ["html", { open: "never" }],
    ],
    use: {
        baseURL: `http://${canisterId}.localhost:${webServerPort}`,
        trace: "on-first-retry",
    },
    projects: [
        {
            name: "chromium",
            use: { ...devices["Desktop Chrome"] },
        },
    ],
});
