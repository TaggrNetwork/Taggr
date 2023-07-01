export function textToNumber(text: string): number {
    return parseInt(text.replace(",", ""));
}

export function icpToE8s(icpAmount: number): bigint {
    return BigInt(Math.floor(icpAmount * 10 ** 8));
}
