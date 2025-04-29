# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build/Test Commands

-   Build frontend: `npm run build`
-   Build canister: `FEATURES=dev ./build.sh taggr`
-   Local deploy: `make local_deploy`
-   Format frontend: `npm run format`
-   Test rust code: `cargo test [test_name] -- --test-threads 1`
-   Run e2e tests: `npm run test:e2e [test_filename].spec.ts`
-   Lint Rust code: `cargo clippy --tests --benches -- -D clippy::all`

## Code Style Guidelines

-   **Rust:** Use Rust 1.81.0 with rustfmt and clippy. Format error handling with explicit Result types
-   **TypeScript/React:** Use functional components with React hooks. Format with Prettier
-   **Naming:** camelCase for JS/TS, snake_case for Rust
-   **Error Handling:** Rust - use explicit Result types. TS - prefer try/catch with async/await
-   **Testing:** Single-threaded Rust tests with `--test-threads 1`, e2e tests with Playwright
-   **Types:** Use TypeScript interfaces & enums in frontend, Rust structs/enums in backend
-   **Imports:** Group imports by source (std, external, internal)
