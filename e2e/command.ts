import { execSync } from "node:child_process";

export const transferICP = (acc: string, amount: number | string) => {
    const cmd = `dfx --identity local-minter ledger transfer --amount ${amount} --memo 0 ${acc}`;
    exec(cmd);
};

export const mkPwd = (word: string) => word.toUpperCase() + "Password1234!";

export function exec(cmd: string): string {
    const result = execSync(cmd);

    return result.toString().replace(/(\r\n|\n|\r)/gm, "");
}
