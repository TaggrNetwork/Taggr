//! Dev methods used for testing only.

use super::*;
use crate::env::post::Post;
use crate::env::user::UserId;
use ic_cdk::spawn;
use ic_cdk_macros::{query, update};
use ic_cdk_timers::set_timer;
use serde_bytes::ByteBuf;
use std::time::Duration;

#[update]
async fn reset() {
    clear_buckets().await;
    STATE.with(|cell| {
        let mut state: State = Default::default();
        state.init();
        state.memory.init();
        // as expected in E2E tests
        {
            state.auction.amount = CONFIG.weekly_auction_size_tokens_min;
            state.auction.last_auction_price_e8s = 15000000;
        }
        cell.replace(state);
    });
    set_timer(Duration::from_millis(0), || {
        spawn(State::fetch_xdr_rate());
    });
}

#[update]
// This method needs to be triggered to test an upgrade locally.
async fn chores() {
    State::chores(time()).await;
}

#[update]
async fn weekly_chores() {
    if canisters::check_for_pending_upgrade().is_ok() {
        State::weekly_chores(time()).await;
    } else {
        set_timer(Duration::from_millis(500), || {
            spawn(weekly_chores());
        });
    }
}

#[query]
async fn check() {
    read(|state| {
        let last_id = state.next_post_id.saturating_sub(1);
        let sum = (0..=last_id)
            .filter_map(|id| Post::get(&state, &id))
            .map(|post| post.id)
            .sum::<u64>();
        assert_eq!(sum, (last_id.pow(2) + last_id) / 2);
    });
}

#[update]
async fn clear_buckets() {
    use ic_cdk::api::management_canister::{
        main::{delete_canister, stop_canister},
        provisional::CanisterIdRecord,
    };
    for (canister_id, _) in mutate(|state| std::mem::take(&mut state.storage.buckets)) {
        let _: Result<(), _> = stop_canister(CanisterIdRecord { canister_id }).await;
        let _: Result<(), _> = delete_canister(CanisterIdRecord { canister_id }).await;
    }
}

#[update]
fn replace_user_principal(principal: String, user_id: UserId) {
    mutate(|state| {
        use crate::token::Account;
        let principal = Principal::from_text(principal).unwrap();
        state.principals.insert(principal, user_id);
        let user_principal = state.principal_to_user(principal).unwrap().principal;
        let balance = state
            .balances
            .remove(&Account {
                owner: user_principal,
                subaccount: None,
            })
            .unwrap();
        state.balances.insert(
            Account {
                owner: principal,
                subaccount: None,
            },
            balance,
        );
        let user = state.principal_to_user_mut(principal).unwrap();
        user.principal = principal;
    });
}

#[update]
fn create_test_user(name: String) -> u64 {
    mutate(|state| {
        state
            .new_test_user(caller(), time(), name.clone(), Some(1_000_000_000))
            .unwrap()
    })
}

#[update]
fn make_stalwart(user_handle: String) {
    mutate(|state| {
        state
            .users
            .values_mut()
            .find(|user| &user.name == &user_handle)
            .map(|user| {
                user.stalwart = true;
            })
    });
}

#[update]
// Backup restore method.
fn stable_mem_write(input: Vec<(u64, ByteBuf)>) {
    use ic_cdk::api::stable;
    if let Some((page, buffer)) = input.get(0) {
        if buffer.is_empty() {
            return;
        }
        let mut hasher = Sha256::new();
        hasher.update(&buffer);
        let result = hasher.finalize();
        use sha2::{Digest, Sha256};
        let hash = format!("{:x}", result);
        ic_cdk::println!("/* {} */ \"{}\",", page, hash);
        if *page == 0 {
            ic_cdk::println!("{:?}", &buffer[..16])
        }
        let offset = page * BACKUP_PAGE_SIZE as u64;
        let current_size = stable::stable_size();
        let needed_size = ((offset + buffer.len() as u64) >> 16) + 1;
        let delta = needed_size.saturating_sub(current_size);
        if delta > 0 {
            stable::stable_grow(delta).unwrap_or_else(|_| panic!("couldn't grow memory"));
        }
        stable::stable_write(offset, buffer);
    }
}

#[update]
// Backup restore method.
fn stable_to_heap() {
    stable_to_heap_core();
}
