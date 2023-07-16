import { customAlphabet, nanoid } from "nanoid";

const generateAlphaString = customAlphabet("abcdefghijklmnopqrstuvxzy");

const generateAlphanumericalString = customAlphabet(
    "0123456789ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvxzy",
);

const generateLowerAlphanumericalString = customAlphabet(
    "0123456789abcdefghijklmnopqrstuvxzy",
);

export function randomIntInRange(low = 0, high = 10): number {
    const offset = high - low;

    return Math.floor(Math.random() * offset + low);
}

function generateRandomWord(wordLength = randomIntInRange(2, 12)): string {
    return generateAlphaString(wordLength);
}

export function generateRealmName(): string {
    return generateRandomWord();
}

export function generateHashTag(): string {
    return generateRandomWord();
}

export function generateGitCommitHash(): string {
    return generateLowerAlphanumericalString(40);
}

export function generateText(numWords = 30): string {
    let text = "";

    for (let i = 0; i < numWords; i++) {
        text += generateRandomWord() + " ";
    }

    return text.trim();
}

export function generateUsername(
    usernameLength = randomIntInRange(2, 16),
): string {
    const username = generateAlphanumericalString(usernameLength);

    if (/\d/.test(username[0])) {
        return generateUsername();
    }

    return username;
}

export function generateAboutYou(): string {
    return generateText();
}

export function generateSeedPhrase(): string {
    return nanoid();
}
