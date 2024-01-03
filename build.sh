#!/bin/sh

FEATURES="${FEATURES:-}"
echo "Features: $FEATURES"

for pkg in $1; do
    cargo build -q --target wasm32-unknown-unknown --release --package $pkg --features "$FEATURES" --locked
    WASM_FILE=target/wasm32-unknown-unknown/release/$pkg.wasm
    if [[ "$2" == *"with_candid"* ]]
    then
        candid-extractor $WASM_FILE > "src/backend/$pkg.did"
    fi
    ic-wasm $WASM_FILE -o $WASM_FILE shrink
    gzip -nf9v $WASM_FILE
done
