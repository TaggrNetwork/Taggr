//! Dev methods used for testing only.

use super::*;
use crate::env::user::UserId;
use ic_cdk::spawn;
use ic_cdk_macros::update;
use ic_cdk_timers::set_timer;
use std::time::Duration;

#[update]
async fn reset() {
    clear_buckets().await;
    STATE.with(|cell| cell.replace(Default::default()));
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

#[update]
async fn clear_buckets() {
    use canisters::management_canister_call;
    for (canister_id, _) in mutate(|state| std::mem::take(&mut state.storage.buckets)) {
        let _: Result<(), _> = management_canister_call(canister_id, "stop_canister").await;
        let _: Result<(), _> = management_canister_call(canister_id, "delete_canister").await;
    }
}

#[update]
fn replace_user_principal(principal: String, user_id: UserId) {
    mutate(|state| {
        state
            .principals
            .insert(Principal::from_text(principal).unwrap(), user_id)
    });
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
