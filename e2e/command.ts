import { execSync } from "node:child_process";

export function exec(cmd: string): string {
    const result = execSync(cmd);

    return result.toString().replace(/(\r\n|\n|\r)/gm, "");
}
