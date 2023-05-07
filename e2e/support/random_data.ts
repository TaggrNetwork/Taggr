import { customAlphabet } from "nanoid";

const generateAlphanumericalString = customAlphabet(
  "0123456789ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvxzy"
);

export function generateUsername(): string {
  const username = generateAlphanumericalString(14);

  if (/\d/.test(username[0])) {
    return generateUsername();
  }

  return username;
}
