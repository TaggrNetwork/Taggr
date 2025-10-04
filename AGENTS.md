# Taggr Agent Guide

## Build Commands

-   `make start` - Start local DFX replica
-   `make local_deploy` - Deploy to local replica with dev features
-   `make dev_build` - Build backend and bucket with dev features
-   `make local_reinstall` - Reinstall local deployment
-   `make build` - Production build (backend + frontend)
-   `npm run build` - Build frontend only
-   `make fe` - Production frontend build
-   `FEATURES=dev ./build.sh taggr` - Build backend with dev features
-   `make cycles` - Fabricate cycles for local canisters

## Test Commands

-   `make test` - Run all tests (builds, lints, Rust tests, E2E tests)
-   `cargo test -- --test-threads 1` - Run Rust tests single-threaded
-   `npm run test:e2e` - Run Playwright E2E tests
-   `make e2e_test` - Full E2E test setup and execution
-   `npm run test:e2e -- --ui` - Run E2E tests with UI
-   `npm run test:e2e -- --trace on` - Run E2E tests with trace

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

-   `src/backend/lib.rs` - Backend main entry point
-   `src/backend/env/mod.rs` - Backend environment and state
-   `src/frontend/src/types.tsx` - TypeScript types
-   `src/frontend/src/theme.ts` - Theme definitions
-   `e2e/*.spec.ts` - E2E tests
-   `Makefile` - Common workflows
-   `docs/LOCAL_DEVELOPMENT.md` - Development setup guide
