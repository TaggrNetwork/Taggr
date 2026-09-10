# AGENTS.md

User instructions **always** override this file.

## Taggr

Taggr is a decentralized social network on the Internet Computer, governed by its token holders. Read [WHITEPAPER.md](./src/frontend/assets/WHITEPAPER.md) first — it defines the domain model behind the codebase:

-   **Credits**: users prepay ICP for credits; every interaction (post, react, poll, realm) burns credits → Treasury revenue.
-   **Rewards**: users earn reward points from reactions/responses, converted to ICP weekly or auto-topped-up to credits when low.
-   **Token**: fixed max supply; burned on transfer fees, minted via weekly mining (rewards / market price from weekly auction) or minting proposals. Founder vesting logic applies.
-   **Realms**: sub-communities with own rules; moderators can move/flag posts.
-   **Stalwarts**: top active token holders; moderate reported users, share penalty rewards.
-   **Governance**: proposals with locked token escrow; controversial rejections burn the escrow; quorum decays 1%/day.
-   **Domains**: one frontend, configured per domain — moderation pushed to edge domain owners.

Whitepaper uses `$placeholders` (e.g. `$post_cost`, `$token_symbol`) — concrete values live in backend constants (see `src/backend/env` / config module).

## Layout

-   `src/backend/` — main canister (Rust). Entry `lib.rs`; `updates.rs`/`queries.rs` = all endpoints; `http.rs` = asset serving; `taggr.did` = public Candid interface.
-   `src/bucket/` — user media storage canisters (per-user, user-owned).
-   `src/frontend/` — React/TS SPA served by the canister; `api.ts` wraps the Candid interface.
-   `e2e/` — Playwright tests and local minter identity setup.
-   `icp.yaml` — icp-cli project config (canisters, environments); `.icp/data/mappings/` holds mainnet canister IDs.

## Commands

-   `make format` then `cargo check --tests` after any backend change; `npx tsc --noEmit` after frontend changes. Full gate: `make check`.
-   `make start` (icp network), `make local_deploy` (taggr), `make local_reinstall` for clean state.
-   `make test` = full suite (clippy `-D all`, cargo test single-threaded, e2e). `make tests` runs everything in a container (podman preferred).
-   Wasm builds via `./build.sh <pkg>` with `FEATURES=dev|staging` (not plain cargo).
