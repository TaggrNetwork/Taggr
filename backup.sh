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
    GATEWAY_URL=$(icp network status --json | jq -r .gateway_url)
    WEBSERVER_PORT=${GATEWAY_URL##*:}
    DFX_URL="http://localhost:${WEBSERVER_PORT}" $BACKUP $DIR restore $(jq -r ".taggr" .icp/cache/mappings/local.ids.json) $PAGE_START
    echo "Clearing buckets before restoring heap..."
    icp canister call taggr clear_buckets '("")' || 1
    echo "Restoring heap..."
    icp canister call taggr stable_to_heap
    echo "Clearing buckets after restoring heap..."
    icp canister call taggr clear_buckets '("")'
else
    echo "Running backup to $DIR..."
    git rev-parse HEAD > $DIR/commit.txt
    if [ "$PAGE_START" -eq 0 ]; then
        icp canister call -e ic taggr backup
    fi
    $BACKUP $DIR backup "6qfxa-ryaaa-aaaai-qbhsq-cai" $PAGE_START
fi

