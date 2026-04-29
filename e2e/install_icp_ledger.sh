#!/usr/bin/env bash
# Install the ICP ledger canister at its mainnet ID (ryjl3-tyaaa-aaaaa-aaaba-cai)
# on the local replica. The backend hard-codes that principal via
# ic-ledger-types::MAINNET_LEDGER_CANISTER_ID, so e2e tests need a real ledger
# answering at that exact ID. The dfx.json `specified_id` pin makes that work
# without `dfx nns install` and without a `system` subnet.
set -euo pipefail

VERSION="$(cat .icp-ledger-version | xargs)"
DIR="e2e/icp_ledger"
WASM="${DIR}/ledger.wasm.gz"
DID="${DIR}/ledger.did"

mkdir -p "${DIR}"

if [ ! -s "${WASM}" ]; then
  curl -fsSL \
    "https://download.dfinity.systems/ic/${VERSION}/canisters/ledger-canister.wasm.gz" \
    -o "${WASM}"
fi

if [ ! -s "${DID}" ]; then
  # Repo path moved mid-2024; try the new layout first, fall back to the old one.
  curl -fsSL \
    "https://raw.githubusercontent.com/dfinity/ic/${VERSION}/rs/ledger_suite/icp/ledger.did" \
    -o "${DID}" \
  || curl -fsSL \
    "https://raw.githubusercontent.com/dfinity/ic/${VERSION}/rs/rosetta-api/icp_ledger/ledger.did" \
    -o "${DID}"
fi

# The ledger forbids fee>0 on transfers from the minting_account, so the
# test identity (local-minter) cannot be the minting_account — `transferICP`
# in e2e tests sends regular fee-paying transfers via `dfx ledger transfer`,
# which uses the default 10_000 e8s fee. Use a separate `minter` identity as
# the minting_account and pre-fund local-minter via initial_values instead.
if ! dfx identity get-principal --identity minter >/dev/null 2>&1; then
  dfx identity new minter --storage-mode=plaintext
fi

MINTER_ACCOUNT=$(dfx ledger account-id --identity minter)
LOCAL_MINTER_ACCOUNT=$(dfx ledger account-id --identity local-minter)

# --mode reinstall so re-running this script (e.g. between e2e iterations)
# wipes ledger state and re-applies the Init args instead of attempting an
# upgrade with an Init-shaped payload.
dfx deploy icp_ledger --mode reinstall -y --argument "(variant { Init = record {
  minting_account = \"${MINTER_ACCOUNT}\";
  initial_values = vec {
    record { \"${LOCAL_MINTER_ACCOUNT}\"; record { e8s = 100_000_000_000_000 : nat64 } };
  };
  send_whitelist = vec {};
  transfer_fee = opt record { e8s = 10_000 : nat64 };
  token_symbol = opt \"ICP\";
  token_name = opt \"Internet Computer\";
} })"
