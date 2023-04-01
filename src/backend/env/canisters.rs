use std::collections::HashMap;

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
use serde::Deserialize;

use super::Logger;

const CYCLES_FOR_NEW_CANISTER: u64 = 1_000_000_000_000;
pub static mut CALLS: Option<HashMap<String, i32>> = None;

pub fn call_opened(id: &str) {
    unsafe {
        CALLS
            .as_mut()
            .unwrap()
            .entry(id.into())
            .and_modify(|c| *c += 1)
            .or_insert(1);
    }
}

pub fn call_closed(id: &str) {
    unsafe {
        CALLS
            .as_mut()
            .unwrap()
            .entry(id.into())
            .and_modify(|c| *c -= 1)
            .or_insert(-1);
    }
}

pub fn init() {
    unsafe { CALLS = Some(Default::default()) };
}

pub fn calls_open() -> usize {
    unsafe { CALLS.as_mut().unwrap().values().filter(|v| **v > 0).count() }
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
    let calls = calls_open();
    if calls > 0 && !force {
        logger.error(format!(
                "Upgrade execution failed: {} canister calls are in-flight: {:?}. Please re-trigger the upgrade finalization.",
                calls,
                unsafe { &CALLS }
        ));
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

pub async fn set_controllers(
    canister_id: Principal,
    controllers: Vec<Principal>,
) -> Result<(), String> {
    #[derive(CandidType)]
    struct In {
        canister_id: Principal,
        settings: CanisterSettings,
    }
    call_opened("update_settings");
    let result = call(
        Principal::management_canister(),
        "update_settings",
        (In {
            canister_id,
            settings: CanisterSettings {
                controllers: Some(controllers),
            },
        },),
    )
    .await;
    call_closed("update_settings");
    result.map_err(|err| format!("couldn't set controllers: {:?}", err))?;
    Ok(())
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
