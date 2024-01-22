use crate::env::user::UserFilter;

use super::*;
use env::{
    canisters::get_full_neuron,
    config::CONFIG,
    parse_amount,
    post::{Extension, Post, PostId},
    proposals::{Release, Reward},
    user::{Draft, User, UserId},
    State,
};
use ic_cdk::{
    api::{
        self,
        call::{arg_data_raw, reply_raw},
    },
    spawn,
};
use ic_cdk_macros::{init, post_upgrade, pre_upgrade, update};
use ic_cdk_timers::{set_timer, set_timer_interval};
use ic_ledger_types::{AccountIdentifier, Tokens};
use serde_bytes::ByteBuf;
use std::collections::BTreeSet;
use std::time::Duration;

#[init]
fn init() {
    mutate(|state| {
        state.load();
        state.last_weekly_chores = time();
        state.last_daily_chores = time();
        state.last_hourly_chores = time();
    });
    set_timer(Duration::from_millis(0), || {
        spawn(State::fetch_xdr_rate());
    });
    set_timer_interval(Duration::from_secs(15 * 60), || {
        spawn(State::chores(api::time()))
    });
}

#[pre_upgrade]
fn pre_upgrade() {
    mutate(env::memory::heap_to_stable)
}

#[post_upgrade]
fn post_upgrade() {
    // This should prevent accidental deployments of dev or staging releases.
    #[cfg(any(feature = "dev", feature = "staging"))]
    {
        let ids: &str = include_str!("../../canister_ids.json");
        if ids.contains(&format!("\"ic\": \"{}\"", &api::id().to_string())) {
            panic!("dev or staging feature is enabled!")
        }
    }
    stable_to_heap_core();
    mutate(|state| state.load());
    set_timer_interval(Duration::from_secs(15 * 60), || {
        spawn(State::chores(api::time()))
    });
    set_timer(
        Duration::from_millis(0),
        || spawn(State::finalize_upgrade()),
    );

    // post upgrade logic goes here
    set_timer(Duration::from_millis(0), move || {
        spawn(post_upgrade_fixtures())
    });
}

async fn post_upgrade_fixtures() {}

/*
 * UPDATES
 */

#[cfg(not(feature = "dev"))]
#[update]
fn prod_release() -> bool {
    true
}

/// Fetches the full neuron info of the TaggrDAO proving the neuron decentralization
/// and voting via hot-key capabilities.
#[update]
async fn get_neuron_info() -> Result<String, String> {
    get_full_neuron(CONFIG.neuron_id).await
}

#[export_name = "canister_update vote_on_poll"]
fn vote_on_poll() {
    let (post_id, vote, anonymously): (PostId, u16, bool) = parse(&arg_data_raw());
    mutate(|state| reply(state.vote_on_poll(caller(), api::time(), post_id, vote, anonymously)));
}

#[export_name = "canister_update report"]
fn report() {
    mutate(|state| {
        let (domain, id, reason): (String, u64, String) = parse(&arg_data_raw());
        reply(state.report(caller(), domain, id, reason))
    });
}

#[export_name = "canister_update vote_on_report"]
fn vote_on_report() {
    mutate(|state| {
        let (domain, id, vote): (String, u64, bool) = parse(&arg_data_raw());
        reply(state.vote_on_report(caller(), domain, id, vote))
    });
}

#[export_name = "canister_update clear_notifications"]
fn clear_notifications() {
    mutate(|state| {
        let ids: Vec<u64> = parse(&arg_data_raw());
        if let Some(user) = state.principal_to_user_mut(caller()) {
            user.clear_notifications(ids)
        }
        reply_raw(&[]);
    })
}

#[update]
fn link_cold_wallet(user_id: UserId) -> Result<(), String> {
    mutate(|state| state.link_cold_wallet(caller(), user_id))
}

#[update]
fn unlink_cold_wallet() {
    mutate(|state| state.unlink_cold_wallet(caller()))
}

#[export_name = "canister_update withdraw_rewards"]
fn withdraw_rewards() {
    spawn(async {
        reply(State::withdraw_rewards(caller()).await);
    })
}

#[export_name = "canister_update tip"]
fn tip() {
    spawn(async {
        let (post_id, amount): (PostId, u64) = parse(&arg_data_raw());
        reply(State::tip(caller(), post_id, amount).await);
    })
}

#[export_name = "canister_update react"]
fn react() {
    let (post_id, reaction): (PostId, u16) = parse(&arg_data_raw());
    mutate(|state| reply(state.react(caller(), post_id, reaction, api::time())));
}

#[export_name = "canister_update update_last_activity"]
fn update_last_activity() {
    mutate(|state| {
        if let Some(user) = state.principal_to_user_mut(caller()) {
            user.last_activity = api::time()
        }
    });
    reply_raw(&[]);
}

#[export_name = "canister_update change_principal"]
fn change_principal() {
    spawn(async {
        let principal: String = parse(&arg_data_raw());
        reply(State::change_principal(caller(), principal).await);
    });
}

#[export_name = "canister_update update_user"]
fn update_user() {
    let (new_name, about, principals): (String, String, Vec<String>) = parse(&arg_data_raw());
    reply(User::update(
        caller(),
        optional(new_name),
        about,
        principals,
    ))
}

#[export_name = "canister_update update_user_settings"]
fn update_user_settings() {
    let (settings, filter, governance): (
        std::collections::BTreeMap<String, String>,
        UserFilter,
        bool,
    ) = parse(&arg_data_raw());
    reply(User::update_settings(
        caller(),
        settings,
        filter,
        governance,
    ))
}

#[export_name = "canister_update create_user"]
fn create_user() {
    let (name, invite): (String, Option<String>) = parse(&arg_data_raw());
    spawn(async {
        reply(State::create_user(caller(), name, invite).await);
    });
}

#[export_name = "canister_update transfer_credits"]
fn transfer_credits() {
    let (recipient, amount): (UserId, Credits) = parse(&arg_data_raw());
    reply(mutate(|state| {
        let sender = state.principal_to_user(caller()).expect("no user found");
        let recipient_name = &state.users.get(&recipient).expect("no user found").name;
        state.credit_transfer(
            sender.id,
            recipient,
            amount,
            CONFIG.credit_transaction_fee,
            Destination::Credits,
            format!(
                "credit transfer from @{} to @{}",
                sender.name, recipient_name
            ),
            Some(format!(
                "You have received `{}` credits from @{}",
                amount, sender.name
            )),
        )
    }))
}

#[export_name = "canister_update widthdraw_rewards"]
fn widthdraw_rewards() {
    spawn(async { reply(State::withdraw_rewards(caller()).await) });
}

#[export_name = "canister_update mint_credits"]
fn mint_credits() {
    spawn(async {
        let kilo_credits: u64 = parse(&arg_data_raw());
        reply(State::mint_credits(caller(), kilo_credits).await)
    });
}

#[export_name = "canister_update create_invite"]
fn create_invite() {
    let credits: Credits = parse(&arg_data_raw());
    mutate(|state| reply(state.create_invite(caller(), credits)));
}

#[export_name = "canister_update propose_add_realm_controller"]
fn propose_add_realm_controller() {
    let (description, user_id, realm_id): (String, UserId, RealmId) = parse(&arg_data_raw());
    reply(mutate(|state| {
        proposals::propose(
            state,
            caller(),
            description,
            proposals::Payload::AddRealmController(realm_id, user_id),
            time(),
        )
    }))
}

#[export_name = "canister_update propose_icp_transfer"]
fn propose_icp_transfer() {
    let (description, receiver, amount): (String, String, String) = parse(&arg_data_raw());
    reply({
        match (
            AccountIdentifier::from_hex(&receiver),
            parse_amount(&amount, 8),
        ) {
            (Ok(account), Ok(amount)) => mutate(|state| {
                proposals::propose(
                    state,
                    caller(),
                    description,
                    proposals::Payload::ICPTransfer(account, Tokens::from_e8s(amount)),
                    time(),
                )
            }),
            (Err(err), _) | (_, Err(err)) => Err(err),
        }
    })
}

#[update]
fn propose_release(description: String, commit: String, binary: ByteBuf) -> Result<u32, String> {
    mutate(|state| {
        proposals::propose(
            state,
            caller(),
            description,
            proposals::Payload::Release(Release {
                commit,
                binary: binary.to_vec(),
                hash: Default::default(),
            }),
            time(),
        )
    })
}

#[export_name = "canister_update propose_reward"]
fn propose_reward() {
    let (description, receiver): (String, String) = parse(&arg_data_raw());
    mutate(|state| {
        reply(proposals::propose(
            state,
            caller(),
            description,
            proposals::Payload::Reward(Reward {
                receiver,
                votes: Default::default(),
                minted: 0,
            }),
            time(),
        ))
    })
}

#[export_name = "canister_update propose_funding"]
fn propose_funding() {
    let (description, receiver, tokens): (String, String, u64) = parse(&arg_data_raw());
    mutate(|state| {
        reply(proposals::propose(
            state,
            caller(),
            description,
            proposals::Payload::Fund(receiver, tokens * token::base()),
            time(),
        ))
    })
}

#[export_name = "canister_update vote_on_proposal"]
fn vote_on_proposal() {
    let (proposal_id, vote, data): (u32, bool, String) = parse(&arg_data_raw());
    mutate(|state| {
        reply(proposals::vote_on_proposal(
            state,
            time(),
            caller(),
            proposal_id,
            vote,
            &data,
        ))
    })
}

#[export_name = "canister_update cancel_proposal"]
fn cancel_proposal() {
    let proposal_id: u32 = parse(&arg_data_raw());
    mutate(|state| proposals::cancel_proposal(state, caller(), proposal_id));
    reply(());
}

#[update]
/// This method adds a post atomically (from the user's point of view).
async fn add_post(
    body: String,
    blobs: Vec<(String, Blob)>,
    parent: Option<PostId>,
    realm: Option<RealmId>,
    extension: Option<Blob>,
) -> Result<PostId, String> {
    let post_id = mutate(|state| {
        let extension: Option<Extension> = extension.map(|bytes| parse(&bytes));
        Post::create(
            state,
            body,
            &blobs,
            caller(),
            api::time(),
            parent,
            realm,
            extension,
        )
    })?;
    let call_name = format!("blobs_storing_for_{}", post_id);
    canisters::open_call(&call_name);
    let result = Post::save_blobs(post_id, blobs).await;
    canisters::close_call(&call_name);
    result.map(|_| post_id)
}

#[update]
/// This method initiates an asynchronous post creation.
fn add_post_data(body: String, realm: Option<RealmId>, extension: Option<Blob>) {
    mutate(|state| {
        if let Some(user) = state.principal_to_user_mut(caller()) {
            user.draft = Some(Draft {
                body,
                realm,
                extension,
                blobs: Default::default(),
            });
        };
    })
}

#[update]
/// This method adds a blob to a post being created
fn add_post_blob(id: String, blob: Blob) -> Result<(), String> {
    mutate(|state| {
        if let Some(user) = state.principal_to_user_mut(caller()) {
            let credits = user.credits();
            if let Some(draft) = user.draft.as_mut() {
                if credits < (draft.blobs.len() + 1) as u64 * CONFIG.blob_cost {
                    user.draft.take();
                    return;
                }
                draft.blobs.push((id, blob))
            }
        }
    });
    Ok(())
}

#[update]
/// This method finalizes the post creation.
async fn commit_post() -> Result<PostId, String> {
    if let Some(Some(Draft {
        body,
        realm,
        extension,
        blobs,
    })) = mutate(|state| {
        state
            .principal_to_user_mut(caller())
            .map(|user| user.draft.take())
    }) {
        add_post(body, blobs, None, realm, extension).await
    } else {
        Err("no post data found".into())
    }
}

#[update]
async fn edit_post(
    id: PostId,
    body: String,
    blobs: Vec<(String, Blob)>,
    patch: String,
    realm: Option<RealmId>,
) -> Result<(), String> {
    Post::edit(id, body, blobs, patch, realm, caller(), api::time()).await
}

#[export_name = "canister_update delete_post"]
fn delete_post() {
    mutate(|state| {
        let (post_id, versions): (PostId, Vec<String>) = parse(&arg_data_raw());
        reply(state.delete_post(caller(), post_id, versions))
    });
}

#[export_name = "canister_update toggle_bookmark"]
fn toggle_bookmark() {
    mutate(|state| {
        let post_id: PostId = parse(&arg_data_raw());
        if let Some(user) = state.principal_to_user_mut(caller()) {
            reply(user.toggle_bookmark(post_id));
            return;
        };
        reply(false);
    });
}

#[export_name = "canister_update toggle_following_post"]
fn toggle_following_post() {
    let post_id: PostId = parse(&arg_data_raw());
    let user_id = read(|state| state.principal_to_user(caller()).expect("no user found").id);
    reply(
        mutate(|state| Post::mutate(state, &post_id, |post| Ok(post.toggle_following(user_id))))
            .unwrap_or_default(),
    )
}

#[export_name = "canister_update toggle_following_user"]
fn toggle_following_user() {
    let followee_id: UserId = parse(&arg_data_raw());
    mutate(|state| reply(state.toggle_following_user(caller(), followee_id)))
}

#[export_name = "canister_update toggle_following_feed"]
fn toggle_following_feed() {
    mutate(|state| {
        let tags: Vec<String> = parse(&arg_data_raw());
        reply(
            state
                .principal_to_user_mut(caller())
                .map(|user| user.toggle_following_feed(tags))
                .unwrap_or_default(),
        )
    })
}

#[export_name = "canister_update edit_realm"]
fn edit_realm() {
    mutate(|state| {
        let (
            id,
            logo,
            label_color,
            theme,
            description,
            controllers,
            whitelist,
            user_filter,
            cleanup_penalty,
        ): (
            RealmId,
            String,
            String,
            String,
            String,
            BTreeSet<UserId>,
            BTreeSet<UserId>,
            UserFilter,
            Credits,
        ) = parse(&arg_data_raw());
        reply(state.edit_realm(
            caller(),
            id,
            logo,
            label_color,
            theme,
            description,
            controllers,
            whitelist,
            user_filter,
            cleanup_penalty,
        ))
    })
}

#[export_name = "canister_update realm_clean_up"]
fn realm_clean_up() {
    mutate(|state| {
        let (post_id, reason): (PostId, String) = parse(&arg_data_raw());
        reply(state.clean_up_realm(caller(), post_id, reason))
    });
}

#[export_name = "canister_update create_realm"]
fn create_realm() {
    mutate(|state| {
        let (
            name,
            logo,
            label_color,
            theme,
            description,
            controllers,
            whitelist,
            user_filter,
            cleanup_penalty,
        ): (
            String,
            String,
            String,
            String,
            String,
            BTreeSet<UserId>,
            BTreeSet<UserId>,
            UserFilter,
            Credits,
        ) = parse(&arg_data_raw());
        reply(state.create_realm(
            caller(),
            name,
            logo,
            label_color,
            theme,
            description,
            controllers,
            whitelist,
            user_filter,
            cleanup_penalty,
        ))
    })
}

#[export_name = "canister_update toggle_realm_membership"]
fn toggle_realm_membership() {
    mutate(|state| {
        let name: String = parse(&arg_data_raw());
        reply(state.toggle_realm_membership(caller(), name))
    })
}

#[export_name = "canister_update toggle_filter"]
fn toggle_filter() {
    mutate(|state| {
        let (filter, value): (String, String) = parse(&arg_data_raw());
        reply(if let Some(user) = state.principal_to_user_mut(caller()) {
            user.toggle_filter(filter, value)
        } else {
            Err("no user found".into())
        });
    })
}

#[update]
async fn set_emergency_release(binary: ByteBuf) {
    mutate(|state| {
        if binary.is_empty()
            || !state
                .principal_to_user(caller())
                .map(|user| user.stalwart)
                .unwrap_or_default()
        {
            return;
        }
        state.emergency_binary = binary.to_vec();
        state.emergency_votes.clear();
    });
}

#[export_name = "canister_update confirm_emergency_release"]
fn confirm_emergency_release() {
    mutate(|state| {
        let principal = caller();
        if let Some(balance) = state
            .principal_to_user(principal)
            .map(|user| user.total_balance(state))
        {
            let hash: String = parse(&arg_data_raw());
            use sha2::{Digest, Sha256};
            let mut hasher = Sha256::new();
            hasher.update(&state.emergency_binary);
            if hash == format!("{:x}", hasher.finalize()) {
                state.emergency_votes.insert(principal, balance);
            }
        }
        reply_raw(&[]);
    })
}

// This function is the last resort of triggering the emergency upgrade and is expected to be used.
#[update]
fn force_emergency_upgrade() -> bool {
    mutate(|state| state.execute_pending_emergency_upgrade(true))
}

fn caller() -> Principal {
    let caller = ic_cdk::caller();
    assert_ne!(caller, Principal::anonymous(), "authentication required");
    caller
}
