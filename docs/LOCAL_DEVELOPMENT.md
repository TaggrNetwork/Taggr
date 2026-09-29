# Local Development

## Command Reference

Make sure to follow the steps outlined in the rest of this file before using these commands.

| Description                       | Command                                       | Note                                                    |
| --------------------------------- | --------------------------------------------- | ------------------------------------------------------- |
| Start the local network           | make start                                    |                                                         |
| Start the frontend server         | npm start                                     |                                                         |
| Build the canister                | make build                                    |                                                         |
| Build the frontend                | npm run build                                 |                                                         |
| Production frontend               | make fe                                       |                                                         |
| Production frontend local network | NODE_ENV=production DFX_NETWORK=local make fe |                                                         |
| Deploy the canister locally       | make local_deploy                             |                                                         |
| Build the canister locally        | make dev_build                                |                                                         |
| Set up and run e2e tests          | make e2e_test                                 | If you're using Ubuntu, it must be an LTS version.      |
| Run e2e tests                     | npm run test:e2e                              | Assumes e2e setup is already done (see `make e2e_test`) |

## System Dependencies

-   Install [NodeJS](https://nodejs.org/).
-   Install [Rust & Cargo](https://www.rust-lang.org/).
-   Install [ic-wasm](https://github.com/dfinity/ic-wasm).
-   Install [icp-cli](https://github.com/dfinity/icp-cli).
-   Install [Docker](https://www.docker.com/).
-   Install [Git](https://git-scm.com/).

## First Time Setup

Clone the Taggr repo:

```shell
git clone git@github.com:TaggrNetwork/taggr.git
```

Change your directory to the newly cloned Taggr repo:

```shell
cd taggr
```

Install icp-cli and ic-wasm:

```shell
npm install -g @icp-sdk/icp-cli @icp-sdk/ic-wasm
```

Start the local network:

```shell
make start
```

The managed network launched by icp-cli ships the system canisters Taggr
depends on at their mainnet IDs (the ICP ledger at
`ryjl3-tyaaa-aaaaa-aaaba-cai` and the Cycles Minting Canister at
`rkp4c-7iaaa-aaaaa-aaaca-cai`), and seeds every identity that exists at
network start with ICP and cycles. No custom ledger or CMC stub is needed.

Install Taggr canister:

```shell
npm ci
make local_deploy
make dev_build
make local_reinstall
```

`make local_deploy` builds and installs the backend at the current local
canister ID, recorded in `.icp/cache/mappings/local.ids.json`.

Use `make cycles` to top the canister up with cycles.

Now you are ready to create a new Taggr account with Internet Identity locally
and, if you want, transfer ICP to it. Identify the account ID from the Taggr UI
and send ICP from a funded identity:

```shell
icp token transfer 10 ${accountId}
```

The identity you deploy with is seeded with 100k ICP and 1,000T cycles by the
local network.

## e2e Tests

Make sure to follow the [first time setup instructions](#first-time-setup) before running e2e tests without using the Dockerfile.

Run the test UI, this is great for watching the tests run as they are happening and checking screenshots at each stage:

Make sure javascript is built for tests (production) as it avoids binary file size limits. Make sure to re-build if you make changes.

```shell
make e2e_build
```

Run tests:

```shell
npm run test:e2e -- --ui
```

To collect a static trace for tests:

```shell
npm run test:e2e -- --trace on
```

To help determine if tests are flaky, run them multiple times, note that only the file's name is required, not its full path. If the filename is omitted then all tests will be run multiple times:

```shell
npm run test:e2e -- ${test_filename}.spec.ts --trace on --repeat-each 10
```

During development, it can be common to write an incorrect selector or something else that will cause the test to timeout. If it's happening frequently and slowing down the feedback cycle then the max timeout can be set to a lower value. Be careful not to set it too low or you may get false negatives in the tests:

```shell
npm run test:e2e -- --timeout 10000
```
