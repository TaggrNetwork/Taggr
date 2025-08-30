# Taggr Agent Guide

## Build Commands

-   `make start` - Start local replica
-   `make local_deploy` - Deploy to local replica
-   `make test` - Run all tests (Rust + E2E)
-   `npm run build` - Build frontend
-   `FEATURES=dev ./build.sh taggr` - Build backend with dev features

## Test Commands

-   `cargo test --test backend_tests` - Run specific Rust test module
-   `cargo test -- --test-threads 1` - Run Rust tests single-threaded
-   `npm run test:e2e` - Run Playwright E2E tests
-   `POCKET_IC_MUTE_SERVER=true cargo test` - Run PocketIC tests quietly

## Lint/Format Commands

-   `npm run format` - Format TypeScript/JS with Prettier
-   `npm run format:check` - Check formatting
-   `cargo clippy --tests --benches -- -D clippy::all` - Rust linting
-   `cargo fmt` - Format Rust code

## Code Style Guidelines

-   **Rust**: 4-space indentation, snake_case, explicit error handling
-   **TypeScript**: Prettier defaults, camelCase, strict typing
-   **Imports**: Group stdlib, external, internal imports
-   **Error handling**: Use Result/Option, avoid unwrap() in production code
-   **Naming**: Descriptive names, avoid abbreviations

## Key Files

-   `src/backend/lib.rs` - Main entry point
-   `src/frontend/src/types.tsx` - TypeScript types
-   `tests/src/backend_tests.rs` - Integration tests
-   `Makefile` - Common workflows
