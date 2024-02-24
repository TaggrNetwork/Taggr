#!/bin/sh

export PATH=${HOME}/.local/share/dfx/bin:${PATH}

make build
make start
dfx deploy
OUTPUT=$(dfx canister call taggr prod_release)
if [ "$OUTPUT" != "(true)" ]; then
  echo "Error: dev feature is enabled!"
  exit 1
fi
dfx stop
