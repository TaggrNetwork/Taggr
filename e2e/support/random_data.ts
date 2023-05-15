import { customAlphabet, nanoid } from "nanoid";

const generateAlphaString = customAlphabet("abcdefghijklmnopqrstuvxzy");

const generateAlphanumericalString = customAlphabet(
  "0123456789ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvxzy"
);

function randomIntInRange(low = 0, high = 10): number {
  const offset = high - low;

  return Math.floor(Math.random() * offset + low);
}

function generateRandomWord(wordLength = randomIntInRange(2, 12)): string {
  return generateAlphaString(wordLength);
}

export function generateHashTag(): string {
  return generateRandomWord();
}

export function generateText(numWords = 30): string {
  let text = "";

  for (let i = 0; i < numWords; i++) {
    text += generateRandomWord() + " ";
  }

  return text.trim();
}

export function generateUsername(): string {
  const username = generateAlphanumericalString(14);

  if (/\d/.test(username[0])) {
    return generateUsername();
  }

  return username;
}

export function generateSeedPhrase(): string {
  return nanoid();
}
