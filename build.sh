#!/bin/bash

FEATURES="${FEATURES:-}"
echo "Features: $FEATURES"

TARGET=wasm32-unknown-unknown


for pkg in $1; do
    # NOTE: On macOS a specific version of llvm-ar and clang need to be set here.
    # Otherwise the wasm compilation of rust-secp256k1 will fail.
    if [ "$(uname)" == "Darwin" ]; then
        LLVM_PATH=$(brew --prefix llvm)
        # On macs we need to use the brew versions
        AR="${LLVM_PATH}/bin/llvm-ar" CC="${LLVM_PATH}/bin/clang" cargo build -q --target $TARGET --release --package $pkg --features "$FEATURES" --locked
    else
        cargo build -q --target $TARGET --release --package $pkg --features "$FEATURES" --locked
    fi
    WASM_FILE=target/$TARGET/release/$pkg.wasm
    ic-wasm $WASM_FILE -o $WASM_FILE shrink
    gzip -nf9v $WASM_FILE
done
