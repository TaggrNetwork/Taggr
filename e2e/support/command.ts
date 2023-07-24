import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";

export function exec(cmd: string): string {
    const result = execSync(cmd);

    return result.toString().replace(/(\r\n|\n|\r)/gm, "");
}

export function loadWasm(): Uint8Array {
    const binaryPath = resolve(
        __dirname,
        "..",
        "..",
        "target",
        "wasm32-unknown-unknown",
        "release",
        "taggr.wasm.gz",
    );

    const buffer = readFileSync(binaryPath);
    return Uint8Array.from(buffer);
}
