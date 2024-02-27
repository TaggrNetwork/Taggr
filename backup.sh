#!/bin/sh

DIR=$1
echo "Using directory $DIR"
CMD=$2
# This script is based on https://forum.dfinity.org/t/canister-backup/11777/26
QU=../qu/target/release/qu

set -e

mkdir -p $DIR

size() {
    FILE="$1"
    if [[ "$OSTYPE" == "darwin"* ]]; then
        stat -f%z $FILE
    else
        stat -c%s $FILE
    fi
}

restore() {
    FILE="$1"
    echo "Restoring $FILE..."
    $QU raw $(cat .dfx/local/canister_ids.json | jq -r ".taggr.local") "stable_mem_write" --args-file "$FILE" | $QU send --yes --raw - > /dev/null
}

if [ "$CMD" == "restore" ]; then
    export IC_URL=http://localhost:8080
    PAGE=0
    while true; do
        for _ in {1..10}; do
            FILE="$DIR/page$PAGE.bin"
            restore $FILE &
            PAGE=$((PAGE + 1))
        done
        wait
        if [ "$(size $FILE)" == "18" ]; then break; fi
    done
    echo "Clearing buckets before restoring heap..."
    dfx canister call taggr clear_buckets '("")' || 1
    echo "Restoring heap..."
    dfx canister call taggr stable_to_heap
    echo "Clearing buckets after restoring heap..."
    dfx canister call taggr clear_buckets '("")'
    echo "Checking consistency..."
    dfx canister call taggr check
    exit 0
fi

fetch() {
    FILE="$1"
    $QU raw "6qfxa-ryaaa-aaaai-qbhsq-cai" "stable_mem_read" --args "($PAGE:nat64)" --query |\
        $QU send --yes --raw - > $FILE
}

git rev-parse HEAD > $DIR/commit.txt
dfx canister --network ic call taggr backup

PAGE=0
while true; do
    for _ in {1..10}; do
        FILE="$DIR/page$PAGE.bin"
        echo "Fetching page $PAGE..."
        fetch $FILE &
        PAGE=$((PAGE + 1))
    done
    wait
    if [ "$(size $FILE)" == "18" ]; then break; fi
done

