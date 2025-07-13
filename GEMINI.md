# Gemini Agent Project Guide: taggr

This document provides a technical overview of the `taggr` project for the Gemini agent. It covers the architecture, development workflows, and key components.

## 1. Project Overview

Taggr is a fully decentralized social media platform built on the Internet Computer. It combines features of forums and blogs, operating on a token-based economic model where users own and govern the platform. Revenue is generated through user interactions (credits) and shared with content creators and token holders, eliminating the need for ads.

**Core Concepts:**

-   **Credits:** Used by users to pay for actions like posting and reacting.
-   **Tokens ($token_symbol):** Grant governance rights and a share of platform revenue.
-   **Realms:** Topic-based communities with their own rules.
-   **Stalwarts:** Trusted, high-stake users who perform moderation.
-   **Governance:** The platform is upgraded and managed via user-submitted proposals.

## 2. Tech Stack

-   **Backend:** Rust
-   **Frontend:** React & TypeScript
-   **Blockchain:** Internet Computer
-   **Build Tools:** Webpack, Cargo
-   **Testing:**
    -   **E2E:** Playwright
    -   **Integration (Backend):** PocketIC
-   **Deployment:** `dfx` CLI

## 3. Project Structure

```
/
├── src/
│   ├── backend/      # Main backend Rust canister ('taggr')
│   │   ├── env/      # Modules for state/logic (users, posts, etc.)
│   │   └── taggr.did # Public interface for the backend canister
│   ├── bucket/       # Rust canister for storage (e.g., blobs, assets)
│   └── frontend/     # React/TypeScript frontend SPA
│       └── src/
│           ├── api.ts        # Backend canister interaction logic
│           └── index.tsx     # Frontend entry point
├── tests/            # Rust integration tests (using PocketIC)
├── e2e/              # Playwright end-to-end tests
├── dfx.json          # Internet Computer project configuration
├── package.json      # Frontend dependencies and scripts
├── Cargo.toml        # Rust workspace and backend dependencies
├── build.sh          # Script for building Rust canisters to WASM
└── Makefile          # Helper commands for building, testing, deploying
```

## 4. Canisters

The application is composed of several canisters (smart contracts):

-   **`taggr`**: The main backend canister containing the core business logic for posts, users, governance, etc. Its public API is defined in `src/backend/taggr.did`.
-   **`bucket`**: A storage canister, likely used for handling large data like images or other user-uploaded assets.
-   **`frontend`**: An asset canister that serves the compiled React frontend application.

## 5. Development Workflows

### Backend (Rust)

-   **Build Canisters:** The `build.sh` script compiles the Rust canisters into optimized WASM. This is typically called via `dfx` or the `Makefile`.
    ```bash
    # Build a specific canister (e.g., taggr) for development
    FEATURES=dev ./build.sh taggr
    ```
-   **Run Integration Tests:** Backend tests use `cargo test` and are executed against a local PocketIC instance, which simulates the Internet Computer environment.
    ```bash
    # Run all backend tests
    cargo test
    ```

### Frontend (React)

-   **Start Dev Server:**
    ```bash
    npm start
    ```
-   **Build for Production:**
    ```bash
    npm run build
    ```
-   **Run E2E Tests:**
    ```bash
    # Make sure a local replica is running and canisters are deployed
    npm run test:e2e
    ```

### Full Project

The `Makefile` provides the most convenient commands for managing the full project.

-   **Start Local Replica:**
    ```bash
    make start
    ```
-   **Deploy Locally:** This command builds all necessary canisters and deploys them to the local replica.
    ```bash
    make local_deploy
    ```
-   **Run All Tests (Lint, Backend, E2E):**
    ```bash
    make test
    ```
-   **Deploy to Staging:**
    ```bash
    make staging_deploy
    ```
