#!/bin/bash

DIR=$1
CMD=$2
PAGE_START=${3:-0}
BACKUP=./backup/target/release/backup

if [ ! -f $BACKUP ]; then
    cd backup
    cargo build --bin backup --release
    cd ..
fi

set -e

mkdir -p $DIR

if [ "$CMD" == "restore" ]; then
    echo "Running restore from $DIR..."
    WEBSERVER_PORT=$(dfx info webserver-port)
    DFX_URL="http://localhost:${WEBSERVER_PORT}" $BACKUP $DIR restore $(cat .dfx/local/canister_ids.json | jq -r ".taggr.local") $PAGE_START
    echo "Clearing buckets before restoring heap..."
    dfx canister call taggr clear_buckets '("")' || 1
    echo "Restoring heap..."
    dfx canister call taggr stable_to_heap
    echo "Clearing buckets after restoring heap..."
    dfx canister call taggr clear_buckets '("")'
else
    echo "Running backup to $DIR..."
    git rev-parse HEAD > $DIR/commit.txt
    if [ "$PAGE_START" -eq 0 ]; then
        dfx canister --network ic call taggr backup
    fi
    $BACKUP $DIR backup "6qfxa-ryaaa-aaaai-qbhsq-cai" $PAGE_START
fi

