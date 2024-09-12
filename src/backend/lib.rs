use std::{cell::RefCell, collections::HashMap};

use candid::Principal;
use env::{config::CONFIG, user::User, State, *};
use ic_cdk::{api::call::reply_raw, caller};

mod assets;
#[cfg(feature = "dev")]
mod dev_helpers;
mod env;
mod http;
mod metadata;
mod queries;
mod updates;

const BACKUP_PAGE_SIZE: u32 = 1024 * 1024;

thread_local! {
    static STATE: RefCell<State> = Default::default();
}

pub fn read<F, R>(f: F) -> R
where
    F: FnOnce(&State) -> R,
{
    STATE.with(|cell| f(&cell.borrow()))
}

pub fn mutate<F, R>(f: F) -> R
where
    F: FnOnce(&mut State) -> R,
{
    STATE.with(|cell| f(&mut cell.borrow_mut()))
}

fn parse<'a, T: serde::Deserialize<'a>>(bytes: &'a [u8]) -> T {
    serde_json::from_slice(bytes).expect("couldn't parse the input")
}

fn reply<T: serde::Serialize>(data: T) {
    reply_raw(serde_json::json!(data).to_string().as_bytes());
}

fn stable_to_heap_core() {
    STATE.with(|cell| cell.replace(env::memory::stable_to_heap()));
    mutate(|state| state.init());
}

fn optional(s: String) -> Option<String> {
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

pub fn performance_counter(_n: u32) -> u64 {
    #[cfg(test)]
    return 0;
    #[cfg(not(test))]
    ic_cdk::api::performance_counter(_n)
}
pub fn id() -> Principal {
    #[cfg(test)]
    return Principal::anonymous();
    #[cfg(not(test))]
    ic_cdk::id()
}

pub fn time() -> u64 {
    #[cfg(test)]
    return 0;
    #[cfg(not(test))]
    ic_cdk::api::time()
}

use crate::env::{post::PostId, user::UserId};
use crate::http::{HttpRequest, HttpResponse};
use crate::token::{Account, Standard, TransferArgs, TransferError, Value};
use ic_ledger_types::GetBlocksArgs;
use icrc_ledger_types::icrc3::{
    archive::{GetArchivesArgs, GetArchivesResult},
    blocks::{GetBlocksResult, ICRC3DataCertificate, SupportedBlockType},
};
use serde_bytes::ByteBuf;
candid::export_service!();
