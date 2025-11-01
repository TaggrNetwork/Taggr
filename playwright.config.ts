import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
    testDir: "./e2e",
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: 1,
    reporter: [
        ["list", { printSteps: true }],
        ["html", { open: "never" }],
        ["json", { outputFile: "test-results/results.json" }],
    ],
    use: {
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
        video: "retain-on-failure",
        baseURL: process.env["BASE_URL"],
        actionTimeout: 15000,
    },
    projects: [
        {
            name: "chromium",
            use: {
                ...devices["Desktop Chrome"],
                viewport: { width: 1280, height: 720 },
            },
        },
    ],
    expect: {
        timeout: 15000,
        toHaveScreenshot: { maxDiffPixels: 100 },
    },
    globalSetup: require.resolve("./e2e/setup"),
    outputDir: "test-results",
});
