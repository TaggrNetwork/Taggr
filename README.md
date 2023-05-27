# Taggr

## Release proposal verification

Assume you want to verify a new release proposal with code commit `<COMMIT>` and binary hash `<HASH>`.

0. Install Docker (only once).
1. `git clone https://github.com/TaggrNetwork/taggr.git` (only once)
2. `cd taggr`
3. `git fetch --all && git checkout <COMMIT>`
4. `make release`
5. Verify that the printed hash matches the `<HASH>` value from the release page.

## Release proposal

To propose a release, follow the steps above first.
If they were successful, you'll find a binary `release.wasm.gz` in the `taggr` root directory.
Use the printed code commit and the binary to submit a new release proposal.

## Heap Backup (for stalwarts only)

1. Open the browser JS console and trigger this command: `api.call("heap_to_stable")`.
2. Fetch the backup: `DIR=/path/to/backup; ./backup.sh $DIR`.
3. Restore to the local replica: `DIR=/path/to/backup; ./backup.sh $DIR restore`.

## Local Development

Refer to the [local development](./docs/LOCAL_DEVELOPMENT.md) docs for instructions on how to work with Taggr locally.
