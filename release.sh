#!/bin/sh

export PATH=${HOME}/.local/share/dfx/bin:${PATH}

make start
dfx deploy
OUTPUT=$(dfx canister call taggr prod_release)
if [ "$OUTPUT" != "(true)" ]; then
  echo "Error: dev feature is enabled!"
  exit 1
fi
dfx stop
cp .dfx/local/canisters/taggr/taggr.wasm.gz  target/wasm32-unknown-unknown/taggr/taggr.wasm.gz
