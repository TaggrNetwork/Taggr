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

## Running Taggr in a local replica

0. [Install](https://internetcomputer.org/docs/current/tutorials/deploy_sample_app#dfx) `dfx`, `node` and `npm`.
1. Clone the Taggr repo to a folder `taggr`.
2. Switch to the repo directory: `cd taggr`
3. Create the first build: `make build`.
5. Start the local replica: `make start`.
6. Start the frontend server: `npm start`.
7. Deploy the dev build to the replica: `make dev_deploy`.
8. Pull the backup from Taggr (heap only):
   - As a stalwart, execute `api.call("heap_to_stable")` in the the browser console.
   - Locally run: `./backup.sh /path/to/backup`.
9. Restore the backup to the local canister: `./backup.sh /path/to/backup restore`.
