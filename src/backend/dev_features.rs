//! Dev methods used for testing only.

use super::*;

#[update]
// This method needs to be triggered to test an upgrade locally.
async fn chores() {
    State::chores(time()).await;
}

#[query]
async fn check() {
    let (sum, last_id): (u64, u64) = read(|state| {
        let last_id = state.next_post_id.saturating_sub(1);
        (
            (0..=last_id)
                .filter_map(|id| Post::get(&state, &id))
                .map(|post| post.id)
                .sum(),
            last_id,
        )
    });
    assert_eq!(sum, (last_id.pow(2) + last_id) / 2);
}

#[update]
// Promotes any user to a stalwart with 20k tokens.
async fn godmode(username: String) {
    mutate(|state| {
        let user_id = state.user(&username).expect("no user found").id;
        let user = state.users.get_mut(&user_id).expect("no user found");
        user.timestamp -= CONFIG.min_stalwart_account_age_weeks as u64 * env::WEEK;
        user.stalwart = true;
        user.last_activity = time();
        user.active_weeks = CONFIG.min_stalwart_activity_weeks as u32;
        user.change_rewards(25, "test");
        let principal = user.principal;
        token::mint(state, account(principal), CONFIG.max_funding_amount);
    });
}

#[update]
// Promotes any user to trusted status with 20k tokens.
async fn demigodmode(username: String) {
    mutate(|state| {
        let user_id = state.user(&username).expect("no user found").id;
        let user = state.users.get_mut(&user_id).expect("no user found");
        user.timestamp -= 4 * env::WEEK;
        user.last_activity = time();
        user.active_weeks = 4 as u32;
        user.change_rewards(25, "test");
        let principal = user.principal;
        token::mint(state, account(principal), CONFIG.max_funding_amount);
    });
}

#[update]
// Demotes any user to untrusted status with 0 tokens.
async fn peasantmode(username: String) {
    mutate(|state| {
        let user_id = state.user(&username).expect("no user found").id;
        let user = state.users.get_mut(&user_id).expect("no user found");
        user.timestamp = time();
        user.last_activity = time();
        user.active_weeks = 0;
        user.change_rewards(-user.rewards(), "test");
        state.balances.remove(&account(user.principal));
    });
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
// Backup restore method.
fn stable_mem_write(input: Vec<(u64, ByteBuf)>) {
    if let Some((page, buffer)) = input.get(0) {
        if buffer.is_empty() {
            return;
        }
        let offset = page * BACKUP_PAGE_SIZE as u64;
        let current_size = ic_cdk::api::stable::stable64_size();
        let needed_size = ((offset + buffer.len() as u64) >> 16) + 1;
        let delta = needed_size.saturating_sub(current_size);
        if delta > 0 {
            api::stable::stable64_grow(delta).unwrap_or_else(|_| panic!("couldn't grow memory"));
        }
        api::stable::stable64_write(offset, buffer);
    }
}

#[update]
// Backup restore method.
fn stable_to_heap() {
    stable_to_heap_core();
}
