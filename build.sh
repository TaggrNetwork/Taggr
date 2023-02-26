#!/bin/sh

FEATURES="${FEATURES:-}"
echo "Features: $FEATURES"

for pkg in $1; do
    RUSTFLAGS="--remap-path-prefix $(pwd)=/" cargo build --target wasm32-unknown-unknown --release --package $pkg --features "$FEATURES" --locked
    WASM_FILE=target/wasm32-unknown-unknown/release/$pkg.wasm
    ic-cdk-optimizer $WASM_FILE -o $WASM_FILE
    gzip -nf9v $WASM_FILE
done
