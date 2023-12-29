import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
    testDir: "./e2e",
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: 4,
    reporter: [
        ["list", { printSteps: true }],
        ["html", { open: "never" }],
    ],
    use: {
        trace: "on-first-retry",
        baseURL: process.env["BASE_URL"],
    },
    projects: [
        {
            name: "chromium",
            use: { ...devices["Desktop Chrome"] },
        },
    ],
    globalSetup: require.resolve("./e2e/setup"),
});
