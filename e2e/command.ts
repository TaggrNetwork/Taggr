import { execSync } from "node:child_process";

export const transferICP = (acc: string, amount: number | string) => {
    const cmd = `icp token transfer ${amount} ${acc} --identity local-minter`;
    exec(cmd);
};

export const mkPwd = (word: string) => word.toUpperCase() + "Password1234!";

export function exec(cmd: string): string {
    const result = execSync(cmd);

    return result.toString().replace(/(\r\n|\n|\r)/gm, "");
}
