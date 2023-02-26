#!/bin/sh

set -x

FEATURES="${FEATURES:-}"
echo "Features: $FEATURES"

for pkg in $1; do
    cargo build --target wasm32-unknown-unknown --release --package $pkg --features "$FEATURES"
    WASM_FILE=target/wasm32-unknown-unknown/release/$pkg.wasm
    ic-cdk-optimizer $WASM_FILE -o $WASM_FILE
    gzip -nf9v $WASM_FILE
done
