# README

## Upgrade proposal verification

Assume you want to verify a new upgrade proposal with code commit `<COMMIT>` and binary hash `<HASH>`.

0. Install Docker (only once).
1. `git clone https://github.com/TaggrNetwork/taggr.git` (only once)
2. `cd taggr`
3. `git fetch --all && git checkout <COMMIT>`
4. `make release`
5. Verify that the printed hash matches the `<HASH>` value from the release page.

## Release proposal

To propose a release, follow the steps above first.
If they were successful, you'll find a binary `taggr.wasm.gz` in the `release-artifacts` directory.
Use the printed code commit and the binary to submit a new release proposal.

## Backups

Make sure you have [installed cargo](https://doc.rust-lang.org/cargo/getting-started/installation.html).

To create a backup of the Taggr state, run:

    make backup DIR=/path/to/backup

## Local development and contributions

Refer to the [local development](./docs/LOCAL_DEVELOPMENT.md) docs for instructions on how to work with Taggr locally.
