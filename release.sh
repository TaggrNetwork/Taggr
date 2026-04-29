#!/bin/bash
set -eo pipefail

export PATH=${HOME}/.local/share/dfx/bin:${PATH}

run_release() {
  make build
  dfx start --background
  dfx deploy
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
  echo "==> Building frontend + canisters (prerequisite for cargo lint/test)"
  NODE_ENV=production npm run build --quiet
  ./build.sh bucket
  ./build.sh taggr
}

run_lints() {
  echo "==> Lints"
  cargo clippy --tests --benches -- -D clippy::all
  cargo fmt --all -- --check
  npm run format:check
}

run_cargo_tests() {
  echo "==> Cargo tests"
  cargo test -- --test-threads 1
}

run_e2e() {
  echo "==> e2e: dfx network config (system subnet for NNS)"
  mkdir -p "$HOME/.config/dfx"
  cat <<EOF > "$HOME/.config/dfx/networks.json"
{
  "local": {
    "bind": "127.0.0.1:8080",
    "type": "ephemeral",
    "replica": {
      "subnet_type": "system"
    }
  }
}
EOF

  # NNS canisters (sgymv-...) heartbeat-print continuously; filter them out
  # from the entire dfx lifecycle. dfx stop must run inside the subshell so
  # the daemon dies and grep gets EOF.
  (
    echo "==> e2e: dfx start + NNS + canister create"
    dfx start --background -qqqq
    ./e2e/import_local_minter.sh
    dfx nns install
    dfx canister create --all

    echo "==> e2e: dev build (needs .dfx/local/canister_ids.json from create)"
    NODE_ENV=production DFX_NETWORK=local npm run build --quiet
    ./build.sh bucket
    FEATURES=dev ./build.sh taggr

    echo "==> e2e: deploy + cycles"
    FEATURES=dev dfx deploy
    dfx --identity local-minter ledger fabricate-cycles --all --cycles 1000000000000000

    echo "==> e2e: playwright"
    npm run test:e2e

    dfx stop
  ) 2>&1 | grep --line-buffered -v 'sgymv'
}

case "${1:-build}" in
  build)
    run_release
    ;;
  ci)
    prepare_artifacts
    run_lints
    run_cargo_tests
    run_e2e
    rm -rf .dfx
    run_release
    ;;
  *)
    echo "unknown mode: $1 (expected: build | ci)"
    exit 1
    ;;
esac
