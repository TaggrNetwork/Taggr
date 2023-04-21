#!/bin/sh

make build
make start
make dev_deploy
npx playwright test
dfx stop
