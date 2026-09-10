#!/bin/bash
set -eo pipefail

# Quiet by default — only stage markers and the playwright run print. Set
# VERBOSE=1 to stream every underlying tool's stdout/stderr (cargo, icp,
# build.sh, npm, ...) for debugging. fd 3/4 are the redirect targets used
# throughout this script; in quiet mode they go to /dev/null.
if [ "${VERBOSE:-}" = "1" ]; then
  exec 3>&1 4>&2
else
  exec 3>/dev/null 4>/dev/null
fi

run_release() {
  # Rebuild the include_bytes! sources (run_e2e left them as the FEATURES=dev /
  # DFX_NETWORK=local variants). taggr itself is built by `icp deploy`, which
  # runs ./build.sh taggr (including candid:service metadata) and that's the
  # artifact we ship.
  NODE_ENV=production npm run build --quiet >&3 2>&4 &
  fe_pid=$!
  ./build.sh bucket >&3 2>&4
  wait "$fe_pid"
  icp network start -d >&3 2>&4
  icp deploy taggr >&3 2>&4
  icp canister status taggr >&3 2>&4
  OUTPUT=$(icp canister call taggr prod_release '()')
  if [ "$OUTPUT" != "(true)" ]; then
    echo "Error: dev feature is enabled!"
    exit 1
  fi
  icp network stop >&3 2>&4
}

copy_release_artifact() {
  if [ -n "${RELEASE_ARTIFACT_DIR:-}" ]; then
    mkdir -p "${RELEASE_ARTIFACT_DIR}"
    cp target/wasm32-unknown-unknown/release/taggr.wasm.gz "${RELEASE_ARTIFACT_DIR}/taggr.wasm.gz"
  fi
}

prepare_artifacts() {
  # Backend src/backend/assets.rs and env/storage.rs use include_bytes! on
  # dist/frontend/* and target/wasm32-unknown-unknown/release/bucket.wasm.gz,
  # so cargo cannot compile the backend (host-side, for tests/clippy) until
  # those files exist. Nothing embeds the taggr wasm itself, so we don't
  # build it here — run_e2e builds it (FEATURES=dev) and run_release lets
  # `icp deploy` build the production one.
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
  echo "==> [4/7] e2e: identity + network + canister create"
  # Import the minter before the network starts so it gets seeded with ICP and
  # cycles by the managed network launcher.
  ./e2e/import_local_minter.sh >&3 2>&4
  icp network start -d >&3 2>&4
  icp network ping >&3 2>&4
  icp canister create taggr >&3 2>&4 || true

  echo "==> [5/7] e2e: dev build (needs .icp/cache/mappings/local.ids.json from create)"
  NODE_ENV=production DFX_NETWORK=local npm run build --quiet >&3 2>&4 &
  fe_pid=$!
  ./build.sh bucket >&3 2>&4
  wait "$fe_pid"
  FEATURES=dev ./build.sh taggr >&3 2>&4

  echo "==> [6/7] e2e: install + cycles"
  icp canister install taggr --mode reinstall -y \
    --wasm target/wasm32-unknown-unknown/release/taggr.wasm.gz >&3 2>&4
  icp canister top-up taggr --amount 100T --identity local-minter >&3 2>&4

  echo "==> [7/7] e2e: playwright"
  npm run test:e2e

  icp network stop >&3 2>&4
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
  artifact)
    # Produce the wasm without re-running tests; used by the non-amd64 split
    # flow where tests already ran in a host-native container.
    run_release
    copy_release_artifact
    ;;
  release)
    # Tests gate the release: a failure here aborts before run_release thanks
    # to set -e, so a hash is only ever produced for a fully-tested build.
    run_tests
    rm -rf .icp/cache
    run_release
    copy_release_artifact
    ;;
  *)
    echo "unknown mode: $1 (expected: tests | artifact | release)"
    exit 1
    ;;
esac
