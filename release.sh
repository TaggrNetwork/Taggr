#!/bin/bash
set -eo pipefail

export PATH=${HOME}/.local/share/dfx/bin:${PATH}

# Quiet by default — only stage markers and the playwright run print. Set
# VERBOSE=1 to stream every underlying tool's stdout/stderr (cargo, dfx,
# build.sh, npm, ...) for debugging. fd 3/4 are the redirect targets used
# throughout this script; in quiet mode they go to /dev/null.
if [ "${VERBOSE:-}" = "1" ]; then
  exec 3>&1 4>&2
else
  exec 3>/dev/null 4>/dev/null
fi

run_release() {
  # Rebuild the include_bytes! sources (run_e2e left them as the FEATURES=dev /
  # DFX_NETWORK=local variants). taggr itself isn't built here — dfx deploy
  # runs ./build.sh taggr via dfx.json's `build` field, and that's the only
  # invocation whose output we keep (after dfx adds candid:service metadata).
  NODE_ENV=production npm run build --quiet >&3 2>&4 &
  fe_pid=$!
  ./build.sh bucket >&3 2>&4
  wait "$fe_pid"
  dfx start --background >&3 2>&4
  dfx deploy taggr >&3 2>&4
  dfx canister info taggr >&3 2>&4
  OUTPUT=$(dfx canister call taggr prod_release)
  if [ "$OUTPUT" != "(true)" ]; then
    echo "Error: dev feature is enabled!"
    exit 1
  fi
  dfx stop >&3 2>&4
  cp .dfx/local/canisters/taggr/taggr.wasm.gz target/wasm32-unknown-unknown/release/taggr.wasm.gz
}

prepare_artifacts() {
  # Backend src/backend/assets.rs and env/storage.rs use include_bytes! on
  # dist/frontend/* and target/wasm32-unknown-unknown/release/bucket.wasm.gz,
  # so cargo cannot compile the backend (host-side, for tests/clippy) until
  # those files exist. Nothing embeds the taggr wasm itself, so we don't
  # build it here — run_e2e builds it (FEATURES=dev) and run_release lets
  # dfx deploy build the production one.
  echo "==> [1/7] Building frontend + bucket (prerequisites for cargo lint/test)"
  NODE_ENV=production npm run build --quiet >&3 2>&4 &
  fe_pid=$!
  ./build.sh bucket >&3 2>&4
  wait "$fe_pid"
}

run_lints() {
  echo "==> [2/7] Lints"
  cargo clippy -q --tests --benches -- -D clippy::all >&3 2>&4
  cargo fmt --all -- --check >&3 2>&4
  npm run format:check --silent >&3 2>&4
}

run_cargo_tests() {
  echo "==> [3/7] Cargo tests"
  cargo test -q -- --test-threads 1 >&3 2>&4
}

run_e2e() {
  echo "==> [4/7] e2e: dfx start + ICP ledger + canister create"
  dfx start --background >&3 2>&4
  ./e2e/import_local_minter.sh >&3 2>&4
  dfx canister create --all >&3 2>&4
  ./e2e/install_icp_ledger.sh >&3 2>&4

  echo "==> [5/7] e2e: dev build (needs .dfx/local/canister_ids.json from create)"
  NODE_ENV=production DFX_NETWORK=local npm run build --quiet >&3 2>&4 &
  fe_pid=$!
  ./build.sh bucket >&3 2>&4
  wait "$fe_pid"
  FEATURES=dev ./build.sh taggr >&3 2>&4

  echo "==> [6/7] e2e: deploy + cycles"
  FEATURES=dev dfx deploy taggr >&3 2>&4
  dfx --identity local-minter ledger fabricate-cycles --all --cycles 1000000000000000 >&3 2>&4

  echo "==> [7/7] e2e: playwright"
  npm run test:e2e

  dfx stop >&3 2>&4
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
