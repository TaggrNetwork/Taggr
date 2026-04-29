#!/bin/bash
set -eo pipefail

export PATH=${HOME}/.local/share/dfx/bin:${PATH}

run_release() {
  make build
  dfx start --background
  dfx deploy taggr
  dfx canister info taggr
  OUTPUT=$(dfx canister call taggr prod_release)
  if [ "$OUTPUT" != "(true)" ]; then
    echo "Error: dev feature is enabled!"
    exit 1
  fi
  dfx stop
  cp .dfx/local/canisters/taggr/taggr.wasm.gz target/wasm32-unknown-unknown/release/taggr.wasm.gz
}

prepare_artifacts() {
  # Backend src/backend/assets.rs and storage.rs use include_bytes! on
  # dist/frontend/* and target/wasm32-unknown-unknown/release/bucket.wasm.gz,
  # so cargo cannot compile the backend (host-side, for tests/clippy) until
  # the frontend and bucket canister have been built.
  echo "==> [1/7] Building frontend + canisters (prerequisite for cargo lint/test)"
  NODE_ENV=production npm run build --quiet >/dev/null 2>&1
  ./build.sh bucket >/dev/null 2>&1
  ./build.sh taggr >/dev/null 2>&1
}

run_lints() {
  echo "==> [2/7] Lints"
  cargo clippy -q --tests --benches -- -D clippy::all
  cargo fmt --all -- --check
  npm run format:check --silent
}

run_cargo_tests() {
  echo "==> [3/7] Cargo tests"
  cargo test -q -- --test-threads 1
}

run_e2e() {
  # Silence the dfx/build chatter to keep CI output (and Claude transcripts)
  # readable — only stage markers and the playwright run itself print. Re-run
  # with `bash -x` or remove the `>/dev/null 2>&1` redirects to debug.
  echo "==> [4/7] e2e: dfx start + ICP ledger + canister create"
  dfx start --background -qqqq >/dev/null 2>&1
  ./e2e/import_local_minter.sh >/dev/null 2>&1
  dfx canister create --all >/dev/null 2>&1
  ./e2e/install_icp_ledger.sh >/dev/null 2>&1

  echo "==> [5/7] e2e: dev build (needs .dfx/local/canister_ids.json from create)"
  NODE_ENV=production DFX_NETWORK=local npm run build --quiet >/dev/null 2>&1
  ./build.sh bucket >/dev/null 2>&1
  FEATURES=dev ./build.sh taggr >/dev/null 2>&1

  echo "==> [6/7] e2e: deploy + cycles"
  FEATURES=dev dfx deploy taggr >/dev/null 2>&1
  dfx --identity local-minter ledger fabricate-cycles --all --cycles 1000000000000000 >/dev/null 2>&1

  echo "==> [7/7] e2e: playwright"
  npm run test:e2e

  dfx stop >/dev/null 2>&1
}

run_tests() {
  prepare_artifacts
  run_lints
  run_cargo_tests
  run_e2e
}

case "${1:-release}" in
  tests)
    run_tests
    ;;
  release)
    # Tests gate the release: a failure here aborts before run_release thanks
    # to set -e, so a hash is only ever produced for a fully-tested build.
    run_tests
    rm -rf .dfx
    run_release
    ;;
  *)
    echo "unknown mode: $1 (expected: tests | release)"
    exit 1
    ;;
esac
