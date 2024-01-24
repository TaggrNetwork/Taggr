use super::{
    time,
    token::{Account, Subaccount, TransferArgs, TransferError},
    Logger, MINUTE,
};
use crate::env::config::CONFIG;
use crate::env::NNSProposal;
use candid::{
    utils::{ArgumentDecoder, ArgumentEncoder},
    CandidType, IDLArgs, Principal,
};
use ic_cdk::api::call::{CallResult, RejectionCode};
use ic_cdk::id;
use ic_cdk::{
    api::{
        call::call_with_payment,
        call::{call, call_raw},
    },
    notify,
};
use ic_ledger_types::MAINNET_GOVERNANCE_CANISTER_ID;
use serde::{Deserialize, Serialize};
use std::cell::RefCell;
use std::collections::HashMap;

const CYCLES_FOR_NEW_CANISTER: u64 = 1_000_000_000_000;

thread_local! {
    static CALLS: RefCell<HashMap<String, i32>> = Default::default();
    // A timestamp of the last upgrading attempt
    static UPGRADE_TIMESTAMP: RefCell<u64> = Default::default();
}

// Panics if an upgrade was initiated within the last 5 minutes. If something goes wrong
// and the canister was not upgraded (and hence the timer was not reset), after 5 minutes
// we start ignoring the timestamp.
fn check_for_pending_upgrade() {
    UPGRADE_TIMESTAMP.with(|cell| {
        let upgrading_attempt = cell.borrow();
        if *upgrading_attempt + 5 * MINUTE > time() {
            panic!("canister upgrading");
        }
    });
}

pub fn open_call(id: &str) {
    check_for_pending_upgrade();
    CALLS.with(|cell| {
        let map = &mut *cell.borrow_mut();
        map.entry(id.into()).and_modify(|c| *c += 1).or_insert(1);
    });
}

pub fn close_call(id: &str) {
    CALLS.with(|cell| {
        let map = &mut *cell.borrow_mut();
        let c = map.get_mut(id).expect("no open call found");
        *c -= 1;
    })
}

pub fn calls_open() -> usize {
    CALLS.with(|cell| cell.borrow().values().filter(|v| **v > 0).count())
}

#[derive(CandidType, Deserialize)]
struct CanisterId {
    canister_id: Principal,
}

#[derive(CandidType)]
struct CanisterSettings {
    pub controllers: Option<Vec<Principal>>,
}

pub async fn new() -> Result<Principal, String> {
    open_call("create_canister");
    let result = call_with_payment(
        Principal::management_canister(),
        "create_canister",
        (CanisterSettings { controllers: None },),
        CYCLES_FOR_NEW_CANISTER,
    )
    .await;
    close_call("create_canister");

    let (response,): (CanisterId,) =
        result.map_err(|err| format!("couldn't create a new canister: {:?}", err))?;

    Ok(response.canister_id)
}

#[derive(CandidType, Deserialize)]
pub enum CanisterInstallMode {
    #[serde(rename = "install")]
    Install,
    #[serde(rename = "reinstall")]
    Reinstall,
    #[serde(rename = "upgrade")]
    Upgrade,
}

#[derive(Deserialize, CandidType)]
pub struct Settings {
    pub controllers: Vec<Principal>,
}

#[derive(Deserialize, CandidType)]
pub struct StatusCallResult {
    pub settings: Settings,
    pub module_hash: Option<Vec<u8>>,
}

pub async fn settings(canister_id: Principal) -> Result<StatusCallResult, String> {
    let result = management_canister_call(canister_id, "canister_status").await;
    let (result,): (StatusCallResult,) =
        result.map_err(|err| format!("couldn't get canister status: {:?}", err))?;
    Ok(result)
}

pub async fn management_canister_call<T: for<'a> ArgumentDecoder<'a>>(
    canister_id: Principal,
    method: &str,
) -> Result<T, (RejectionCode, String)> {
    #[derive(CandidType)]
    struct In {
        canister_id: Principal,
    }

    open_call(method);
    let result = call(
        Principal::management_canister(),
        method,
        (In { canister_id },),
    )
    .await;
    close_call(method);
    result
}

#[derive(CandidType)]
struct InstallCodeArgs<'a> {
    pub mode: CanisterInstallMode,
    pub canister_id: Principal,
    pub wasm_module: &'a [u8],
    pub arg: Vec<u8>,
}

pub async fn install(
    canister_id: Principal,
    wasm_module: &[u8],
    mode: CanisterInstallMode,
) -> Result<(), String> {
    #[derive(CandidType)]
    struct InstallCodeArgs<'a> {
        pub mode: CanisterInstallMode,
        pub canister_id: Principal,
        pub wasm_module: &'a [u8],
        pub arg: Vec<u8>,
    }

    open_call("install_code");
    let result = call(
        Principal::management_canister(),
        "install_code",
        (InstallCodeArgs {
            mode,
            canister_id,
            wasm_module,
            arg: ic_cdk::api::id().as_slice().to_vec(),
        },),
    )
    .await;
    close_call("install_code");

    result.map_err(|err| format!("couldn't install the WASM module: {:?}", err))?;
    Ok(())
}

pub fn upgrade_main_canister(logger: &mut Logger, wasm_module: &[u8], force: bool) {
    check_for_pending_upgrade();
    logger.debug("Executing the canister upgrade...");
    let calls = calls_open();
    if calls > 0 && !force {
        CALLS.with(|cell| {
            logger.warn(format!(
                "Upgrade execution postponed due to open canister calls: {:?}",
                cell.borrow()
                    .iter()
                    .filter(|(_, calls)| **calls > 0)
                    .collect::<Vec<_>>()
            ))
        });
        return;
    }

    UPGRADE_TIMESTAMP.with(|cell| cell.replace(time()));

    notify(
        Principal::management_canister(),
        "install_code",
        (InstallCodeArgs {
            mode: CanisterInstallMode::Upgrade,
            canister_id: id(),
            wasm_module,
            arg: ic_cdk::api::id().as_slice().to_vec(),
        },),
    )
    .expect("self-upgrade failed");
}

pub async fn topup_with_cycles(canister_id: Principal, cycles: u64) -> Result<(), String> {
    #[derive(CandidType)]
    struct Args {
        pub canister_id: Principal,
    }
    open_call("deposit_cycles");
    let result = call_with_payment(
        Principal::management_canister(),
        "deposit_cycles",
        (Args { canister_id },),
        cycles,
    )
    .await;
    close_call("deposit_cycles");
    result.map_err(|err| format!("couldn't deposit cycles: {:?}", err))?;
    Ok(())
}

pub async fn top_up(canister_id: Principal, min_cycle_balance: u64) -> Result<bool, String> {
    let result = call_canister_raw(canister_id, "balance", Default::default()).await;
    let bytes = result.map_err(|err| {
        format!(
            "couldn't get balance from canister {}: {:?}",
            canister_id, err
        )
    })?;
    let mut arr: [u8; 8] = Default::default();
    arr.copy_from_slice(&bytes);
    if u64::from_be_bytes(arr) < min_cycle_balance {
        topup_with_cycles(canister_id, min_cycle_balance)
            .await
            .map_err(|err| format!("failed to top up canister {}: {:?}", canister_id, err))?;
        return Ok(true);
    }
    Ok(false)
}

#[derive(CandidType, Debug, Serialize, Deserialize)]
pub struct NeuronId {
    pub id: u64,
}

pub async fn fetch_proposals() -> Result<Vec<NNSProposal>, String> {
    #[derive(Clone, CandidType, Default, Serialize, Deserialize, PartialEq)]
    pub struct ProposalId {
        pub id: u64,
    }

    #[derive(CandidType, Serialize, Deserialize)]
    pub struct ListProposalInfo {
        pub limit: u32,
        pub before_proposal: Option<ProposalId>,
        pub exclude_topic: Vec<i32>,
        pub include_reward_status: Vec<i32>,
        pub include_status: Vec<i32>,
    }

    #[derive(CandidType, Serialize, Deserialize)]
    pub struct ListProposalInfoResponse {
        pub proposal_info: Vec<ProposalInfo>,
    }

    #[derive(CandidType, Serialize, Deserialize)]
    pub struct ProposalStruct {
        pub title: Option<String>,
        pub summary: String,
    }

    #[derive(CandidType, Serialize, Deserialize)]
    pub struct ProposalInfo {
        pub id: Option<ProposalId>,
        pub proposer: Option<NeuronId>,
        pub proposal: Option<ProposalStruct>,
        pub topic: i32,
    }

    let args = ListProposalInfo {
        include_reward_status: Default::default(),
        before_proposal: Default::default(),
        limit: 25,
        exclude_topic: Default::default(),
        include_status: Default::default(),
    };
    let (response,): (ListProposalInfoResponse,) =
        call_canister(MAINNET_GOVERNANCE_CANISTER_ID, "list_proposals", (args,))
            .await
            .map_err(|err| format!("couldn't call governance canister: {:?}", err))?;

    Ok(response
        .proposal_info
        .into_iter()
        .filter_map(|i| {
            i.proposal.as_ref().map(|p| NNSProposal {
                id: i.id.clone().unwrap_or_default().id,
                title: p.title.clone().unwrap_or_default(),
                summary: p.summary.clone(),
                topic: i.topic,
                proposer: i.proposer.as_ref().expect("no neuron found").id,
            })
        })
        .collect())
}

pub enum NNSVote {
    Adopt = 1,
    Reject = 2,
}

pub async fn get_full_neuron(neuron_id: u64) -> Result<String, String> {
    #[derive(CandidType, Deserialize)]
    struct GovernanceError {
        error_message: String,
    }
    #[derive(CandidType, Debug, Deserialize, Serialize)]
    struct Followees {
        followees: Vec<NeuronId>,
    }
    #[derive(CandidType, Debug, Deserialize, Serialize)]
    struct Neuron {
        id: Option<NeuronId>,
        controller: Option<Principal>,
        hot_keys: Vec<Principal>,
        followees: Vec<(i32, Followees)>,
    }

    let (result,): (Result<Neuron, GovernanceError>,) = call_canister(
        MAINNET_GOVERNANCE_CANISTER_ID,
        "get_full_neuron",
        (neuron_id,),
    )
    .await
    .map_err(|err| format!("couldn't call governance canister: {:?}", err))?;

    result
        .map(|neuron| format!("{:?}", neuron))
        .map_err(|err| err.error_message)
}

pub async fn vote_on_nns_proposal(proposal_id: u64, vote: NNSVote) -> Result<(), String> {
    let args = &format!(
        r#"(record {{
                id = opt record {{ id = {} : nat64 }};
                command = opt variant {{
                    RegisterVote = record {{
                        vote = {} : int32;
                        proposal = opt record {{ id = {} : nat64 }}
                    }}
                }}
            }})"#,
        CONFIG.neuron_id, vote as i32, proposal_id
    )
    .parse::<IDLArgs>()
    .map_err(|err| format!("couldn't parse args: {:?}", err))?
    .to_bytes()
    .map_err(|err| format!("couldn't serialize args: {:?}", err))?;

    let method = "manage_neuron";
    // Sometimes we can't vote because the governance canister gets an upgrade,
    // so we try at most 10 times
    let mut attempts: i16 = 10;
    loop {
        let result =
            call_canister_raw(MAINNET_GOVERNANCE_CANISTER_ID, method, args.as_slice()).await;

        attempts -= 1;

        if result.is_ok() || attempts <= 0 {
            return result
                .map(|_| ())
                .map_err(|err| format!("couldn't call the governance canister: {:?}", err));
        }
    }
}

pub async fn icrc_transfer(
    token: Principal,
    from_subaccount: Option<Subaccount>,
    to: Account,
    amount: u128,
) -> Result<u128, String> {
    let args = TransferArgs {
        from_subaccount,
        to,
        amount,
        memo: None,
        fee: None,
        created_at_time: None,
    };
    let (result,): (Result<u128, TransferError>,) = call_canister(token, "icrc1_transfer", (args,))
        .await
        .map_err(|err| format!("icrc1_transfer call failed: {:?}", err))?;
    result.map_err(|err| format!("{:?}", err))
}

pub async fn call_canister_raw(id: Principal, method: &str, args: &[u8]) -> CallResult<Vec<u8>> {
    open_call(method);
    let result = call_raw(id, method, args, 0).await;
    close_call(method);
    result
}

pub async fn call_canister<T: ArgumentEncoder, R: for<'a> ArgumentDecoder<'a>>(
    id: Principal,
    method: &str,
    args: T,
) -> CallResult<R> {
    open_call(method);
    let result = ic_cdk::call(id, method, args).await;
    close_call(method);
    result
}
