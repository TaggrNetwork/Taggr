// Minimal stub of the IC Cycles Minting Canister for local e2e tests. It
// ignores the ICP block index and the memo — the test ledger transfer just
// needs to succeed, which it will as long as the caller has ICP. The stub
// then creates a canister with the requested controller and returns its
// principal.
//
// Cycles for the spawned canister come out of this stub's own balance, which
// is pre-fabricated by the e2e setup via `dfx ledger fabricate-cycles`.

use candid::{CandidType, Deserialize, Principal};
use ic_cdk_management_canister::{
    create_canister_with_extra_cycles, CanisterSettings, CreateCanisterArgs,
};

const CYCLES_FOR_NEW_CANISTER: u128 = 2_000_000_000_000;

#[derive(CandidType, Deserialize)]
pub struct SubnetFilter {
    pub subnet_type: Option<String>,
}

#[derive(CandidType, Deserialize)]
pub enum SubnetSelection {
    Subnet { subnet: Principal },
    Filter(SubnetFilter),
}

// Mirror of `CanisterSettings` shape we accept from the frontend. We only use
// `controllers` (if provided); the rest is decoded and discarded.
#[derive(CandidType, Deserialize)]
pub struct CanisterSettingsArg {
    pub controllers: Option<Vec<Principal>>,
    pub compute_allocation: Option<candid::Nat>,
    pub memory_allocation: Option<candid::Nat>,
    pub freezing_threshold: Option<candid::Nat>,
    pub reserved_cycles_limit: Option<candid::Nat>,
    pub log_visibility: Option<LogVisibility>,
    pub wasm_memory_limit: Option<candid::Nat>,
    pub wasm_memory_threshold: Option<candid::Nat>,
}

#[derive(CandidType, Deserialize)]
pub enum LogVisibility {
    #[serde(rename = "controllers")]
    Controllers,
    #[serde(rename = "public")]
    Public,
}

#[derive(CandidType, Deserialize)]
pub struct NotifyCreateCanister {
    pub block_index: u64,
    pub controller: Principal,
    pub subnet_selection: Option<SubnetSelection>,
    pub settings: Option<CanisterSettingsArg>,
}

#[derive(CandidType, Deserialize)]
pub enum NotifyError {
    Refunded {
        reason: String,
        block_index: Option<u64>,
    },
    InvalidTransaction(String),
    TransactionTooOld(u64),
    Processing,
    Other {
        error_code: u64,
        error_message: String,
    },
}

#[derive(CandidType, Deserialize)]
pub enum NotifyCreateCanisterResult {
    Ok(Principal),
    Err(NotifyError),
}

#[ic_cdk_macros::update]
async fn notify_create_canister(arg: NotifyCreateCanister) -> NotifyCreateCanisterResult {
    let controllers = arg
        .settings
        .and_then(|s| s.controllers)
        .unwrap_or_else(|| vec![arg.controller]);
    let settings = CanisterSettings {
        controllers: Some(controllers),
        ..Default::default()
    };
    match create_canister_with_extra_cycles(
        &CreateCanisterArgs {
            settings: Some(settings),
        },
        CYCLES_FOR_NEW_CANISTER,
    )
    .await
    {
        Ok(response) => NotifyCreateCanisterResult::Ok(response.canister_id),
        Err(err) => NotifyCreateCanisterResult::Err(NotifyError::Other {
            error_code: 0,
            error_message: format!("{:?}", err),
        }),
    }
}
