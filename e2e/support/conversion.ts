export function textToNumber(text: string): number {
  return parseInt(text.replace(",", ""));
}
