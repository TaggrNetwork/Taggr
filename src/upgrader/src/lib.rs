use canisters::{install, CanisterInstallMode};
use ic_cdk::{
    api::{
        call::{arg_data_raw, reply_raw},
        caller, canister_balance,
    },
    export::Principal,
};
use ic_cdk_macros::*;
use serde_bytes::ByteBuf;

static mut CONTROLLER: Option<Principal> = None;
static mut BLOB: Option<ByteBuf> = None;

fn set_controller() {
    unsafe {
        CONTROLLER = Some(Principal::from_slice(&arg_data_raw()));
    }
}

fn is_controller() -> Result<(), String> {
    if unsafe { CONTROLLER.expect("uninitialized") } == caller() {
        Ok(())
    } else {
        Err("Not a controller".to_string())
    }
}

#[init]
fn init() {
    set_controller();
}

#[post_upgrade]
fn post_upgrade() {
    set_controller();
}

#[update(guard = "is_controller")]
async fn deploy_release(blob: ByteBuf) {
    unsafe {
        BLOB = Some(blob);
    }
}

#[update]
async fn exec() -> Result<(), String> {
    if let Some(blob) = unsafe { BLOB.as_mut().take() } {
        install(
            unsafe { CONTROLLER.expect("no controller") },
            blob.to_vec(),
            CanisterInstallMode::Upgrade,
        )
        .await?;
        Ok(())
    } else {
        Err("no release to deploy".to_string())
    }
}

#[export_name = "canister_query balance"]
fn balance() {
    reply_raw(&canister_balance().to_be_bytes())
}
