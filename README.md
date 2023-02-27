# Taggr

## How to verify a release proposal?

You need to install them only once.

Assume you want to verify a new release proposal with code commit `<COMMIT>` and binary hash `<HASH>`.

0. Install Docker (only once).
1. `git clone https://github.com/TaggrNetwork/taggr.git`
2. `git checkout <COMMIT>`
3. `make release`
4. Verify that the printed hash matches the `<HASH>` value from the release page.

## Heap Backup (for stalwarts only)

1. Open the browser JS console and trigger this command: `api.call("heap_to_stable")`.
2. Fetch the backup: `DIR=/path/to/backup; ./backup.sh $DIR`.
3. Restore to the local replica: `DIR=/path/to/backup; ./backup.sh $DIR restore`.
