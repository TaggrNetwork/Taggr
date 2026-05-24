use super::{
    config::{CONFIG, ICP_CYCLES_PER_XDR},
    invoices, time,
    token::{Account, Subaccount, TransferArgs, TransferError},
    Logger, MINUTE,
};
use crate::{env::NeuronId, id, mutate, read};
use candid::{
    utils::{ArgumentDecoder, ArgumentEncoder},
    CandidType, Principal,
};
use ic_cdk::call::{Call, CallResult};
use ic_cdk_management_canister::{
    update_settings, CanisterIdRecord, CanisterInstallMode, CanisterSettings, CanisterStatusResult,
    InstallCodeArgs, UpdateSettingsArgs,
};
use ic_ledger_types::{Tokens, MAINNET_GOVERNANCE_CANISTER_ID};
use ic_xrc_types::{Asset, GetExchangeRateRequest, GetExchangeRateResult};
use serde::{Deserialize, Serialize};
use std::cell::RefCell;
use std::collections::HashMap;

// uf6dk-hyaaa-aaaaq-qaaaq-cai
const XR_CANISTER_ID: Principal = Principal::from_slice(&[0, 0, 0, 0, 2, 16, 0, 1, 1, 1]);
// e3mmv-5qaaa-aaaah-aadma-cai — IC blackhole canister, kept as a public read-only
// IC controller of every user bucket for transparency.
const BLACKHOLE_TEXT: &str = "e3mmv-5qaaa-aaaah-aadma-cai";

thread_local! {
    static CALLS: RefCell<HashMap<String, i32>> = Default::default();
    // A timestamp of the last upgrading attempt
    static UPGRADE_TIMESTAMP: RefCell<u64> = Default::default();
}

// Panics if an upgrade was initiated within the last 5 minutes. If something goes wrong
// and the canister was not upgraded (and hence the timer was not reset), after 5 minutes
// we start ignoring the timestamp.
pub fn check_for_pending_upgrade() -> Result<(), String> {
    UPGRADE_TIMESTAMP.with(|cell| {
        let upgrading_attempt = cell.borrow();
        if *upgrading_attempt + 5 * MINUTE > time() {
            return Err("canister upgrading".into());
        }
        Ok(())
    })
}

pub fn open_call(id: &str) {
    check_for_pending_upgrade().expect("no upgrades");
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

/// Returns cycles in the canister and cycles burned per day.
pub async fn cycles(canister_id: Principal) -> Result<(u64, u64), String> {
    let CanisterStatusResult {
        cycles,
        idle_cycles_burned_per_day,
        ..
    } = status(canister_id).await?;
    Ok((
        cycles.0.to_u64_digits().last().copied().unwrap_or_default(),
        idle_cycles_burned_per_day
            .0
            .to_u64_digits()
            .last()
            .copied()
            .unwrap_or(1),
    ))
}

pub async fn status(canister_id: Principal) -> Result<CanisterStatusResult, String> {
    open_call("status");
    let response: Result<CanisterStatusResult, String> = async {
        let res = Call::unbounded_wait(Principal::management_canister(), "canister_status")
            .with_arg(&CanisterIdRecord { canister_id })
            .await
            .map_err(|err| format!("couldn't get canister status: {:?}", err))?;
        res.candid::<CanisterStatusResult>()
            .map_err(|err| format!("couldn't decode canister status: {:?}", err))
    }
    .await;
    close_call("status");

    response
}

pub fn upgrade_main_canister(logger: &mut Logger, wasm_module: &[u8], force: bool) {
    check_for_pending_upgrade().expect("no upgrades");
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

    Call::unbounded_wait(Principal::management_canister(), "install_code")
        .with_arg(&InstallCodeArgs {
            mode: CanisterInstallMode::Upgrade(None),
            canister_id: id(),
            wasm_module: wasm_module.to_vec(),
            arg: ic_cdk::api::canister_self().as_slice().to_vec(),
        })
        .oneway()
        .expect("self-upgrade failed");
}

/// Rewrites the IC controllers of `bucket` to `[user, taggr, blackhole]` and the
/// bucket's internal WASM controller set to `[user, taggr]`. Called after a
/// `change_principal` so the user keeps custody of their bucket under their new
/// principal.
pub async fn rotate_bucket_controllers(bucket: Principal, user: Principal) -> Result<(), String> {
    let taggr = ic_cdk::api::canister_self();
    let blackhole =
        Principal::from_text(BLACKHOLE_TEXT).expect("invalid blackhole canister principal");

    open_call("update_settings");
    let ic_result = update_settings(&UpdateSettingsArgs {
        canister_id: bucket,
        settings: CanisterSettings {
            controllers: Some(vec![user, taggr, blackhole]),
            ..Default::default()
        },
    })
    .await;
    close_call("update_settings");
    ic_result.map_err(|err| format!("update_settings on {}: {:?}", bucket, err))?;

    call_canister::<_, ()>(bucket, "update_internal_controllers", (vec![user, taggr],))
        .await
        .map_err(|err| format!("update_internal_controllers on {}: {:?}", bucket, err))?;

    Ok(())
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

pub async fn coins_for_one_xdr(coin: &str) -> Result<u64, String> {
    let args = GetExchangeRateRequest {
        base_asset: Asset {
            symbol: "XDR".into(),
            class: ic_xrc_types::AssetClass::FiatCurrency,
        },
        quote_asset: Asset {
            symbol: coin.into(),
            class: ic_xrc_types::AssetClass::Cryptocurrency,
        },
        timestamp: None,
    };
    let cycles = 10000000000;

    let (response,): (GetExchangeRateResult,) =
        call_canister_with_payment(XR_CANISTER_ID, "get_exchange_rate", (args,), cycles)
            .await
            .map_err(|err| format!("xrc call failed: {:?}", err))?;

    response
        .map_err(|err| format!("couldn't get canister status: {:?}", err))
        // I did not dig into why all responses are x10
        .map(|result| result.rate / 10)
}

#[cfg(not(any(feature = "dev", feature = "staging")))]
pub async fn call_canister_raw(id: Principal, method: &str, args: &[u8]) -> CallResult<Vec<u8>> {
    open_call(method);
    let result = Call::unbounded_wait(id, method)
        .with_raw_args(args)
        .await
        .map(|r| r.into_bytes())
        .map_err(Into::into);
    close_call(method);
    result
}

pub async fn call_canister_with_payment<T: ArgumentEncoder, R: for<'a> ArgumentDecoder<'a>>(
    id: Principal,
    method: &str,
    args: T,
    cycles: u128,
) -> CallResult<R> {
    open_call(method);
    let result: CallResult<R> = async {
        let response = Call::unbounded_wait(id, method)
            .with_args(&args)
            .with_cycles(cycles)
            .await?;
        Ok(response.candid_tuple::<R>()?)
    }
    .await;
    close_call(method);
    result
}

pub async fn call_canister<T: ArgumentEncoder, R: for<'a> ArgumentDecoder<'a>>(
    id: Principal,
    method: &str,
    args: T,
) -> CallResult<R> {
    open_call(method);
    let result: CallResult<R> = async {
        let response = Call::unbounded_wait(id, method).with_args(&args).await?;
        Ok(response.candid_tuple::<R>()?)
    }
    .await;
    close_call(method);
    result
}

/// Tops up the main canister and refreshes legacy-bucket cycle stats. Legacy
/// buckets are no longer topped up — they'll freeze on their own once their
/// cycles run out, and the shared bucket is being retired wholesale. Stats
/// gathering stays so the dashboard can still report their balance.
pub async fn top_up() {
    let bucket_ids = read(|state| state.storage.buckets.keys().cloned().collect::<Vec<_>>());
    let mut bucket_statuses: Vec<(Principal, u64, u64)> = Vec::with_capacity(bucket_ids.len());
    for canister_id in bucket_ids {
        match cycles(canister_id).await {
            Ok((cycles, cycles_per_day)) => {
                bucket_statuses.push((canister_id, cycles, cycles_per_day))
            }
            Err(err) => mutate(|state| {
                state.logger.error(format!(
                    "failed to fetch the cycle balance from `{}`: {}",
                    canister_id, err
                ))
            }),
        }
    }

    // top up the main canister
    match cycles(id()).await {
        Ok((cycles, cycles_per_day)) => {
            mutate(|state| {
                state
                    .canister_cycle_stats
                    .insert(id(), (cycles, cycles_per_day));
            });
            let min_cycles_balance = 10_000_000_000_000;
            if cycles < min_cycles_balance
                || cycles / cycles_per_day < CONFIG.canister_survival_period_days
            {
                let xdrs = ((CONFIG.canister_survival_period_days * cycles_per_day)
                    .max(min_cycles_balance)
                    / ICP_CYCLES_PER_XDR)
                    // Circuit breaker: Never top up for more than ~75$ at once.
                    .min(50);
                let icp = Tokens::from_e8s(xdrs * read(|state| state.e8s_for_one_xdr));
                match invoices::topup_with_icp(&id(), icp).await {
                    Err(err) => mutate(|state| {
                        state.critical(format!(
                    "FAILED TO TOP UP THE MAIN CANISTER — {}'S FUNCTIONALITY IS ENDANGERED: {:?}",
                    CONFIG.name.to_uppercase(),
                    err
                ))
                    }),
                    Ok(_) => mutate(|state| {
                        // subtract weekly burned credits to reduce the revenue
                        state.spend(xdrs * 1000, "main canister top up");
                        state.logger.debug(format!(
                        "The main canister was topped up with credits (balance was `{}`, now `{}`).",
                        cycles,
                        ic_cdk::api::canister_cycle_balance()
                    ))
                    }),
                }
            }
        }
        Err(err) => mutate(|state| {
            state.logger.error(format!(
                "failed to fetch the cycle balance of the main canister: {}",
                err
            ))
        }),
    };

    // Refresh legacy-bucket stats only — no top-up action.
    for (canister_id, cycles, cycles_per_day) in bucket_statuses {
        mutate(|state| {
            state
                .canister_cycle_stats
                .insert(canister_id, (cycles, cycles_per_day));
        });
    }
}
