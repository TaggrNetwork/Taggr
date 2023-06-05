use std::cell::RefCell;
use std::collections::HashMap;
use std::str::FromStr;

use candid::utils::{ArgumentDecoder, ArgumentEncoder};
use ic_cdk::api::call::CallResult;
use ic_cdk::export::candid::{CandidType, Principal};
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

use crate::env::config::CONFIG;
use crate::env::NNSProposal;

use super::Logger;

const CYCLES_FOR_NEW_CANISTER: u64 = 1_000_000_000_000;

thread_local! {
    static CALLS: RefCell<HashMap<String, i32>> = Default::default();
}

pub fn call_opened(id: &str) {
    CALLS.with(|cell| {
        let map = &mut *cell.borrow_mut();
        map.entry(id.into()).and_modify(|c| *c += 1).or_insert(1);
    });
}

pub fn call_closed(id: &str) {
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
    call_opened("create_canister");
    let result = call_with_payment(
        Principal::management_canister(),
        "create_canister",
        (CanisterSettings { controllers: None },),
        CYCLES_FOR_NEW_CANISTER,
    )
    .await;
    call_closed("create_canister");

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
    #[derive(CandidType)]
    struct In {
        canister_id: Principal,
    }

    call_opened("canister_status");
    let result = call(
        Principal::management_canister(),
        "canister_status",
        (In { canister_id },),
    )
    .await;
    call_closed("canister_status");

    let (result,): (StatusCallResult,) =
        result.map_err(|err| format!("couldn't get canister status: {:?}", err))?;
    Ok(result)
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

    call_opened("install_code");
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
    call_closed("install_code");

    result.map_err(|err| format!("couldn't install the WASM module: {:?}", err))?;
    Ok(())
}

pub fn upgrade_main_canister(logger: &mut Logger, wasm_module: &[u8], force: bool) {
    logger.info("Executing the canister upgrade...");
    let calls = calls_open();
    if calls > 0 && !force {
        CALLS.with(|cell| {
            logger.error(format!(
                "Upgrade execution failed due to open canister calls: {:?}",
                cell.borrow()
                    .iter()
                    .map(|(_, calls)| *calls > 0)
                    .collect::<Vec<_>>()
            ))
        });
        return;
    }

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
    call_opened("deposit_cycles");
    let result = call_with_payment(
        Principal::management_canister(),
        "deposit_cycles",
        (Args { canister_id },),
        cycles,
    )
    .await;
    call_closed("deposit_cycles");
    result.map_err(|err| format!("couldn't deposit cycles: {:?}", err))?;
    Ok(())
}

pub async fn top_up(canister_id: Principal, min_cycle_balance: u64) -> Result<bool, String> {
    call_opened("balance");
    let result = call_raw(canister_id, "balance", Default::default(), 0).await;
    call_closed("balance");
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

#[derive(CandidType, Clone, Debug, Serialize, Deserialize)]
pub struct NeuronId {
    pub id: u64,
}

pub async fn fetch_proposals() -> Result<Vec<NNSProposal>, String> {
    #[derive(Clone, CandidType, Default, Serialize, Deserialize, PartialEq)]
    pub struct ProposalId {
        pub id: u64,
    }

    #[derive(CandidType, Clone, Serialize, Deserialize)]
    pub struct ListProposalInfo {
        pub limit: u32,
        pub before_proposal: Option<ProposalId>,
        pub exclude_topic: Vec<i32>,
        pub include_reward_status: Vec<i32>,
        pub include_status: Vec<i32>,
    }

    #[derive(CandidType, Clone, Serialize, Deserialize)]
    pub struct ListProposalInfoResponse {
        pub proposal_info: Vec<ProposalInfo>,
    }

    #[derive(CandidType, Clone, Serialize, Deserialize)]
    pub struct ProposalStruct {
        pub title: Option<String>,
        pub summary: String,
    }

    #[derive(CandidType, Clone, Serialize, Deserialize)]
    pub struct ProposalInfo {
        pub id: Option<ProposalId>,
        pub proposer: Option<NeuronId>,
        pub proposal: Option<ProposalStruct>,
        pub topic: i32,
    }

    let args = ListProposalInfo {
        include_reward_status: Default::default(),
        before_proposal: Default::default(),
        limit: 15,
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
        .filter_map(|info| info.proposal.clone().map(|p| (info, p)))
        .map(|(i, p)| NNSProposal {
            id: i.id.unwrap_or_default().id,
            title: p.title.unwrap_or_default(),
            summary: p.summary,
            topic: i.topic,
            proposer: i.proposer.as_ref().expect("no neuron found").id,
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
    let args = candid::IDLArgs::from_str(&format!(
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
    ))
    .map_err(|err| format!("couldn't parse args: {:?}", err))?
    .to_bytes()
    .map_err(|err| format!("couldn't serialize args: {:?}", err))?;

    let method = "manage_neuron";
    // Sometimes we can't vote because the governance canister gets an upgrade,
    // so we try at most 10 times
    let mut attempts: i16 = 10;
    loop {
        call_opened(method);
        let result = call_raw(MAINNET_GOVERNANCE_CANISTER_ID, method, args.as_slice(), 0).await;
        call_closed(method);

        attempts -= 1;

        if result.is_ok() || attempts <= 0 {
            return result
                .map(|_| ())
                .map_err(|err| format!("couldn't call the governance canister: {:?}", err));
        }
    }
}

pub async fn call_canister<T: ArgumentEncoder, R: for<'a> ArgumentDecoder<'a>>(
    id: Principal,
    method: &str,
    args: T,
) -> CallResult<R> {
    call_opened(method);
    let result = ic_cdk::call(id, method, args).await;
    call_closed(method);
    result
}
