# AGENTS.md

User instructions **always** override this file.

## Taggr

Taggr is a decentralized social network implemented in 2021 and deployed to Internet Computer.
Read the [whitepaper](./src/frontend/assets/WHITEPAPER.md) for more details.

## Approach

-   Be very concise in output but thorough in reasoning.
-   Think before acting and make absolutely sure you understand the problem before trying to solve it.
-   Always ask for clarifications in case of doubts. Never guess.
-   Challenge the user if their inputs are inconsistent with your reasoning.
-   Avoid dependencies at any cost as long as they are not strictly necessary. If you need to use a library, make sure it is widely used and well maintained.
-   Do not re-read files you have already read unless the file may have changed.
-   Keep solutions simple and direct. No over-engineering. Do not invent things if possible, do everything in an idiomatic way.
-   Only fix bugs based on evidence obtained by debugging; never ever create speculative fixes unless user explicitly approved.

## Control

-   Never execute mutable Git commands: the user needs to review all your changes.
-   **Never** execute mutable system commands without user's explicit confirmation unless they asked you to do so.

## Efficiency

-   Always think ahead and try to optimize your steps to reduce the token expense.
-   If you need to consume a really big input, get a user confirmation.

## Code

-   Always apply formatting (make format) and cargo check.
