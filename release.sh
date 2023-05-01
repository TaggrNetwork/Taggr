#!/bin/sh

make build
make start
make dev_deploy
npm run test:e2e
make build
dfx deploy
OUTPUT=$(dfx canister call taggr prod_release)
if [ "$OUTPUT" != "(true)" ]; then
  echo "Error: dev feature is enabled!"
  exit 1
fi
dfx stop
