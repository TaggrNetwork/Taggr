# Taggr Agent Guide

This guide provides essential information for AI agents working with the Taggr codebase. Taggr is a fully decentralized social network running on the Internet Computer, combining features of forums and blogs with token-based governance and revenue sharing.

## Project Overview

**Architecture**: Internet Computer canister smart contracts (Rust backend) + React frontend (TypeScript)

**Key Concepts**:

-   Decentralized social media platform owned by token holders
-   Credit-based usage system with revenue sharing
-   Token governance via proposals
-   Realm-based sub-communities
-   Multi-domain deployment with configurable moderation

**Technology Stack**:

-   Backend: Rust (edition 2018, toolchain 1.90.0) compiled to WebAssembly
-   Frontend: React 19 + TypeScript 5.8 built with Webpack 5
-   Testing: Cargo tests + Playwright E2E tests
-   Deployment: dfx (IC SDK version 0.29.1)

## Build Commands

### Local Development

-   `make start` - Start local DFX replica (binds to 127.0.0.1:8080)
-   `npm start` - Start frontend dev server on port 9090 with hot reload
-   `make dev_build` - Build backend and bucket canisters with dev features
-   `make local_deploy` - Deploy to local replica with FEATURES=dev
-   `make local_reinstall` - Reinstall deployment (includes `make fe`)
-   `make cycles` - Fabricate cycles for local canisters (requires local-minter identity)

### Production Builds

-   `make build` - Full production build (frontend + backend + bucket)
-   `npm run build` - Build frontend only (auto-gzips .js files)
-   `make fe` - Production frontend build (calls `npm run build --quiet`)
-   `./build.sh taggr` - Build taggr canister without features
-   `./build.sh bucket` - Build bucket canister
-   `FEATURES=dev ./build.sh taggr` - Build with dev features enabled
-   `FEATURES=staging ./build.sh taggr` - Build with staging features

### E2E Testing Builds

-   `make e2e_build` - Build for E2E tests (production mode, local network)
-   `NODE_ENV=production DFX_NETWORK=local npm run build` - Manual E2E frontend build

### Release & Verification

-   `make release` - Build release in Docker container, outputs to `release-artifacts/`
-   `make hashes` - Display git commit hash and wasm binary SHA256 hash
-   `make backup DIR=/path/to/backup` - Create state backup

## Test Commands

### Full Test Suite

-   `make test` - Run complete test suite:
    1. `make e2e_build` - Production build for local network
    2. `make local_deploy` - Deploy to local replica
    3. `cargo clippy --tests --benches -- -D clippy::all` - Lint
    4. `cargo test -- --test-threads 1` - Rust unit tests
    5. `npm run test:e2e` - E2E tests

### Rust Tests

-   `cargo test -- --test-threads 1` - Run Rust tests (must be single-threaded)
-   `cargo test` - Run without thread restriction (may cause issues)

### E2E Tests (Playwright)

-   `make e2e_test` - Full E2E setup and run (includes `npm run install:e2e`)
-   `npm run test:e2e` - Run E2E tests (requires prior setup)
-   `npm run test:e2e -- --ui` - Run with Playwright UI for debugging
-   `npm run test:e2e -- --trace on` - Run with trace collection
-   `npm run test:e2e -- test1.spec.ts --trace on --repeat-each 10` - Flakiness testing
-   `npm run test:e2e -- --timeout 10000` - Run with custom timeout (10s)
-   `npm run install:e2e` - Install Playwright Chromium with dependencies

### E2E Test Files

Located in `e2e/`:

-   `test0.spec.ts` through `test4.spec.ts` - Test suites
-   `setup.ts` - Global E2E setup (referenced in playwright.config.ts)
-   `command.ts` - Helper commands
-   `playwright.config.ts` - Playwright configuration

## Lint & Format Commands

### TypeScript/Frontend

-   `npm run format` - Format all files with Prettier
-   `npm run format:check` - Check formatting without changes
-   Pre-commit hook: Uses Prettier v3.0.0 (configured in `.pre-commit-config.yaml`)

### Rust/Backend

-   `cargo clippy --tests --benches -- -D clippy::all` - Lint with all warnings as errors
-   `cargo fmt` - Format Rust code
-   `cargo fmt --all -- --check` - Check formatting (CI)

### CI Checks

See `.github/workflows/lint-and-test.yml` for complete CI pipeline

## Code Style Guidelines

### Rust Backend

-   **Indentation**: 4 spaces (see `.editorconfig`)
-   **Edition**: 2018
-   **Naming**: snake_case for functions/variables, PascalCase for types
-   **Error handling**: Use `Result<T, E>` and `Option<T>`, avoid `unwrap()` in production
-   **Imports**: Group in order: stdlib, external crates, internal modules
-   **Features**: Use `#[cfg(feature = "dev")]` for development-only code
-   **Comments**: Avoid unless complex logic requires explanation
-   **Dependencies**: Check `src/backend/Cargo.toml` and `src/bucket/Cargo.toml`

### TypeScript/React Frontend

-   **Indentation**: 4 spaces for .ts/.tsx, 2 spaces for .yml/.yaml
-   **Naming**: camelCase for functions/variables, PascalCase for components/types
-   **Typing**: Strict typing, define types in `src/frontend/src/types.tsx`
-   **Imports**: Group stdlib → external packages → internal modules
-   **Comments**: Avoid unless necessary
-   **React version**: 19.0.0 (latest features available)
-   **Build**: Webpack with code splitting (vendors, react, dfinity, app-components chunks)

### General

-   **Line endings**: LF (Unix-style)
-   **Encoding**: UTF-8
-   **Final newline**: Required
-   **Trailing whitespace**: Remove

## Project Structure

### Backend Canisters

```
src/backend/          Main Taggr canister
├── env/              State management modules (~4510 lines in mod.rs)
│   ├── auction.rs    Token auction logic
│   ├── bitcoin.rs    Bitcoin integration
│   ├── canisters.rs  Multi-canister management
│   ├── config.rs     Configuration constants
│   ├── delegations.rs Identity delegation
│   ├── domains.rs    Domain management
│   ├── features.rs   Feature flags
│   ├── invite.rs     Invitation system
│   ├── invoices.rs   Payment invoicing
│   ├── memory.rs     Stable memory
│   ├── mod.rs        Core state & environment
│   ├── nns_proposals.rs NNS governance
│   ├── pfp.rs        Profile pictures
│   ├── post_iterators.rs Post iteration logic
│   ├── post.rs       Post data structures
│   ├── proposals.rs  DAO proposals
│   ├── realms.rs     Realm management
│   ├── reports.rs    User reporting
│   ├── search.rs     Search functionality
│   ├── storage.rs    Data storage
│   ├── tip.rs        Tipping system
│   ├── token.rs      Token economics
│   └── user.rs       User management
├── assets.rs         Asset serving
├── dev_helpers.rs    Development utilities
├── http.rs           HTTP interface
├── lib.rs            Main entry point (~92 lines)
├── metadata.rs       Canister metadata
├── queries.rs        Query methods
├── taggr.did         Candid interface
└── updates.rs        Update methods

src/bucket/           Storage bucket canister
├── src/
│   ├── lib.rs        Bucket main
│   └── url.rs        URL handling
└── Cargo.toml        Bucket dependencies
```

### Frontend

```
src/frontend/
├── assets/           Static assets
│   ├── apple-touch-icon.png
│   ├── favicon.ico
│   ├── font-bold.woff2
│   ├── font-regular.woff2
│   ├── logo.min.svg
│   ├── logo.png
│   ├── manifest.json
│   ├── social-image.jpg
│   └── WHITEPAPER.md Full platform documentation
└── src/              React application (~478 lines in index.tsx)
    ├── api.ts        Backend API calls
    ├── authentication.tsx Auth logic
    ├── common.tsx    Common components
    ├── content.tsx   Content rendering
    ├── dashboard.tsx System dashboard
    ├── delegation.tsx Delegation UI
    ├── distribution.tsx Token distribution
    ├── domains.tsx   Domain management UI
    ├── env.ts        Environment config
    ├── feed.tsx      Main feed
    ├── form.tsx      Form components
    ├── header.tsx    Header component
    ├── icons.tsx     Icon definitions
    ├── image_preview.ts Image handling
    ├── inbox.tsx     User inbox
    ├── index.html    HTML template
    ├── index.tsx     App entry point
    ├── invites.tsx   Invitations UI
    ├── journal.tsx   User journal
    ├── landing.tsx   Landing page
    ├── links.tsx     Link handling
    ├── markdown.tsx  Markdown rendering
    ├── new.tsx       New post UI
    ├── poll.tsx      Poll component
    ├── post_feed.tsx Post feed logic
    ├── post.tsx      Post component
    ├── profile.tsx   User profile
    ├── proposals.tsx Governance UI
    ├── realms.tsx    Realms UI
    ├── recovery.tsx  Account recovery
    ├── roadmap.tsx   Roadmap display
    ├── search.tsx    Search interface
    ├── settings.tsx  User settings
    ├── style.css     Global styles
    ├── theme.ts      Theme system
    ├── thread.tsx    Thread view
    ├── token-select.tsx Token selector
    ├── tokens_wallet.tsx Wallet UI
    ├── tokens.tsx    Token management
    ├── types.tsx     TypeScript types
    ├── user_resolve.tsx User resolution
    ├── wallet.tsx    Wallet logic
    ├── welcome.tsx   Welcome screen
    └── whitepaper.tsx Whitepaper viewer
```

### Configuration & Tooling

```
.github/workflows/    CI/CD pipelines
├── docker-image.yml  Docker build workflow
├── e2e-tests.yml     E2E testing workflow
└── lint-and-test.yml Main CI workflow

Root configuration:
├── dfx.json          DFX canister config (v0.29.1)
├── Cargo.toml        Workspace config
├── package.json      NPM scripts & dependencies
├── webpack.config.js Frontend build config
├── playwright.config.ts E2E test config
├── tsconfig.json     TypeScript config
├── rust-toolchain.toml Rust version (1.90.0)
├── .editorconfig     Editor settings
├── .pre-commit-config.yaml Prettier hook
├── Makefile          Common tasks
├── build.sh          Canister build script
├── release.sh        Release script
└── backup.sh         Backup script
```

## Key Files & Entry Points

### Backend

-   `src/backend/lib.rs` (92 lines) - Canister entry point, defines query/update methods
-   `src/backend/env/mod.rs` (4510 lines) - Core state management, largest file
-   `src/backend/taggr.did` - Candid interface definition
-   `src/backend/queries.rs` - Read-only query implementations
-   `src/backend/updates.rs` - State-changing update implementations

### Frontend

-   `src/frontend/src/index.tsx` (478 lines) - React app entry point
-   `src/frontend/src/types.tsx` - All TypeScript type definitions
-   `src/frontend/src/theme.ts` - Theme configuration
-   `src/frontend/src/api.ts` - Backend communication layer
-   `src/frontend/src/env.ts` - Environment variables

### Documentation

-   `README.md` - Upgrade verification & release process
-   `docs/LOCAL_DEVELOPMENT.md` - Complete local setup guide
-   `src/frontend/assets/WHITEPAPER.md` - Full platform documentation
-   `Makefile` - All available commands with targets

### Configuration

-   `dfx.json` - Canister definitions and network config
-   `Cargo.toml` - Workspace with release optimizations (LTO, opt-level=2)
-   `package.json` - NPM scripts and dependencies
-   `webpack.config.js` - Frontend build with chunking strategy

## Development Workflow

### Initial Setup

1. Install dependencies: NodeJS, Rust, ic-wasm, Docker, Git
2. Install DFX: `DFX_VERSION=$(cat dfx.json | jq -r .dfx) sh -ci "$(curl -fsSL https://internetcomputer.org/install.sh)"`
3. Install NPM packages: `npm ci`
4. Configure local network in `~/.config/dfx/networks.json` (port 8080)

### Local Development

1. Start DFX: `make start` or `dfx start --clean --background`
2. Deploy: `make local_deploy && make dev_build && make local_reinstall`
3. Add cycles: `make cycles`
4. Optional: Install NNS canisters with `dfx extension install nns && dfx nns install`
5. Frontend dev server: `npm start` (port 9090, proxies /api to DFX)

### Testing Workflow

1. Build for tests: `make e2e_build`
2. Deploy: `make local_deploy`
3. Run Rust tests: `cargo test -- --test-threads 1`
4. Run E2E tests: `npm run test:e2e -- --ui`
5. Format check: `npm run format:check && cargo fmt --all -- --check`

### Release Process

1. Commit changes and create git tag
2. Build: `make release` (uses Docker/Podman)
3. Verify: Compare output hash with proposal
4. Artifacts in `release-artifacts/taggr.wasm.gz`

## Important Notes

### Feature Flags

-   `dev` - Development features (used in local builds)
-   `staging` - Staging environment features
-   Applied via: `FEATURES=dev ./build.sh taggr`

### Network Configuration

-   `local` - Development (127.0.0.1:8080)
-   `staging` - Staging network (icp-api.io)
-   `staging2` - Alternative staging
-   `ic` - Production mainnet

### Build Artifacts

-   Wasm files: `target/wasm32-unknown-unknown/release/*.wasm.gz`
-   Frontend: `dist/frontend/` (contains gzipped .js files)
-   Release: `release-artifacts/taggr.wasm.gz`

### Testing Constraints

-   Rust tests MUST run with `--test-threads 1`
-   E2E tests run with 1 worker (configured in playwright.config.ts)
-   Ubuntu for E2E must be LTS version
-   Production build required for E2E to avoid binary size limits

### Dependencies to Check Before Adding

Always verify existing dependencies before introducing new ones:

-   Backend: `src/backend/Cargo.toml`, `src/bucket/Cargo.toml`
-   Frontend: `package.json`
-   Check neighbor files for patterns and existing library usage

## Common Issues & Solutions

### Build Issues

-   **macOS llvm-ar error**: Uses `brew --prefix llvm` for AR/CC in `build.sh`
-   **Binary size limits**: Use production builds (`NODE_ENV=production`)
-   **Gzip failures**: Check target/wasm32-unknown-unknown/release/ for .wasm files

### Test Issues

-   **Rust test failures**: Always use `--test-threads 1`
-   **E2E timeouts**: Adjust with `--timeout` flag or in playwright.config.ts
-   **Selector issues**: Use `--ui` mode to debug test steps

### Deployment Issues

-   **Port conflicts**: DFX requires 8080, webpack dev uses 9090
-   **Cycle issues**: Run `make cycles` with local-minter identity
-   **NNS not available**: Install with `dfx extension install nns && dfx nns install`

## Token Economics & Governance

### Key Constants (from whitepaper)

-   Maximum supply: See `$maximum_supply` in config
-   Credits per XDR: See `$credits_per_xdr` in config
-   Post cost: `$post_cost` per KB
-   Proposal escrow: `$proposal_escrow_amount_usd` USD in tokens
-   Approval threshold: `$proposal_approval_threshold%` for proposals
-   Stalwart percentage: Top `$stalwart_percentage%` of token holders

### User Actions & Costs

All costs in credits:

-   Post/comment: `$post_cost` per KB
-   Reactions: 2-11 credits depending on emoji
-   Hashtags: `T * followers(T)` per tag T
-   Polls: `$poll_cost`
-   Realm creation: `$realm_cost`

### Bot Integration

Bots can call `add_post` method via Candid:

```
"add_post": (text, vec record { text; blob }, opt nat64, opt text) -> (variant { Ok: nat64; Err: text });
```

Parameters: body text, images (ID + blob), parent post ID, realm name
Limit: Images must be < `$max_blob_size_bytes`, message < 2MB
