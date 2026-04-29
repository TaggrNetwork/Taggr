# README

## Upgrade proposal verification

Assume you want to verify a new upgrade proposal with code commit `<COMMIT>` and binary hash `<HASH>`.

0. Install Docker (only once).
1. `git clone https://github.com/TaggrNetwork/taggr.git` (only once)
2. `cd taggr`
3. `git fetch --all && git checkout <COMMIT>`
4. `make release`
5. Verify that the printed hash matches the `<HASH>` value from the release page.

`make release` runs the full validation pipeline (lints, Rust tests, Playwright e2e) inside the container and only produces a hash if everything passes. A failing release therefore cannot be hashed — the printed hash is a signal that the wasm is both reproducible and tested. Both Docker and Podman are supported (`PODMAN=1 make release`).

Outputs of a successful run:

-   `release-artifacts/taggr.wasm.gz` — the production wasm.
-   `test-results/` and `playwright-report/` — Playwright traces and the HTML report (open `playwright-report/index.html` to inspect any failures).

Note: the first run is slow (Chromium install layer is several hundred MB) and `dfx nns install` downloads the NNS canisters on every run.

## Release proposal

To propose a release, follow the steps above first.
If they were successful, you'll find a binary `taggr.wasm.gz` in the `release-artifacts` directory.
Use the printed code commit and the binary to submit a new release proposal.

## Running tests during development

For day-to-day iteration, skip the prod build and just run the test suite:

    make tests

Same image as `make release` and the same checks (lints, Rust tests, Playwright e2e), but stops before the deterministic prod build. Use this while iterating; use `make release` when you actually want a hash.

## Backups

Make sure you have [installed cargo](https://doc.rust-lang.org/cargo/getting-started/installation.html).

To create a backup of the Taggr state, run:

    make backup DIR=/path/to/backup

## Local development and contributions

Refer to the [local development](./docs/LOCAL_DEVELOPMENT.md) docs for instructions on how to work with Taggr locally.
