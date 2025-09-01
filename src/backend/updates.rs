use crate::env::{
    domains::{change_domain_config, DomainConfig},
    proposals::{Payload, Release},
    realms::{clean_up_realm, Realm, RealmId},
    user::{Mode, UserFilter},
};

use super::*;
use env::{
    canisters::get_full_neuron,
    config::CONFIG,
    post::{Extension, Post, PostId},
    user::{Draft, User, UserId},
    State,
};
use ic_cdk::{
    api::{
        self,
        call::{arg_data_raw, reply_raw},
        management_canister::main::CanisterId,
    },
    spawn,
};
use ic_cdk_macros::{init, post_upgrade, pre_upgrade, update};
use ic_cdk_timers::{set_timer, set_timer_interval};
use serde_bytes::ByteBuf;
use std::{collections::HashSet, time::Duration};
use user::Pfp;

// Returns the canonical principal (the caller) and checks that it's not anonymous.
fn canonical_principal() -> Principal {
    let principal = ic_cdk::caller();
    assert_ne!(principal, Principal::anonymous(), "authentication required");
    principal
}

/// Returns an error if there is a pending delegate principal;
/// otherwise returns the raw principal.
pub fn raw_caller(state: &State) -> Result<Principal, String> {
    let principal = canonical_principal();
    if delegations::resolve_delegation(state, principal).is_some() {
        return Err("operation not supported on custom domains".into());
    }
    Ok(principal)
}

/// Returns the principal for the provided delegate.
fn caller(state: &State) -> Principal {
    let principal = canonical_principal();
    delegations::resolve_delegation(state, principal).unwrap_or(principal)
}

#[init]
fn init() {
    mutate(|state| {
        state.memory.init();
        let now = time();
        state.timers.last_weekly = now;
        state.timers.last_daily = now;
        state.timers.last_hourly = now;
        state.init();
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

    set_timer_interval(Duration::from_secs(15 * 60), || {
        spawn(State::chores(api::time()))
    });
    set_timer(
        Duration::from_millis(0),
        || spawn(State::finalize_upgrade()),
    );

    sync_post_upgrade_fixtures();

    // post upgrade logic goes here
    set_timer(Duration::from_millis(0), move || {
        spawn(async_post_upgrade_fixtures());
        spawn(bitcoin::update_treasury_address());
    });

    ic_cdk::println!(
        "Post-upgrade spent {}B instructions",
        performance_counter(0) / 1000000000
    )
}

#[allow(clippy::all)]
fn sync_post_upgrade_fixtures() {}

#[allow(clippy::all)]
async fn async_post_upgrade_fixtures() {}

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

#[export_name = "canister_update set_delegation"]
fn set_delegation() {
    let (domain, session_principal): (String, String) = parse(&arg_data_raw());
    reply(mutate(|state| {
        delegations::set_delegation(state, domain, raw_caller(state)?, session_principal, time())
    }))
}

#[export_name = "canister_update set_domain_config"]
fn set_domain_config() {
    let (domain, cfg, command): (String, DomainConfig, String) = parse(&arg_data_raw());
    mutate(|state| {
        reply(change_domain_config(
            state,
            caller(state),
            domain,
            cfg,
            command,
        ))
    })
}

#[export_name = "canister_update vote_on_poll"]
fn vote_on_poll() {
    let (post_id, vote, anonymously): (PostId, u16, bool) = parse(&arg_data_raw());
    mutate(|state| {
        reply(state.vote_on_poll(caller(state), api::time(), post_id, vote, anonymously))
    });
}

#[export_name = "canister_update report"]
fn report() {
    mutate(|state| {
        let (id, reason): (u64, String) = parse(&arg_data_raw());
        reply(reports::report(state, caller(state), id, reason))
    });
}

#[export_name = "canister_update vote_on_report"]
fn vote_on_report() {
    mutate(|state| {
        let (id, vote): (u64, bool) = parse(&arg_data_raw());
        reply(reports::vote_on_report(state, caller(state), id, vote))
    });
}

#[export_name = "canister_update clear_notifications"]
fn clear_notifications() {
    mutate(|state| {
        let ids: Vec<u64> = parse(&arg_data_raw());
        if let Some(user) = state.principal_to_user_mut(caller(state)) {
            user.clear_notifications(ids)
        }
        reply_raw(&[]);
    })
}

#[export_name = "canister_update crypt"]
fn crypt() {
    let seed: String = parse(&arg_data_raw());
    reply(mutate(|state| {
        state.toggle_account_activation(raw_caller(state)?, seed)
    }))
}

#[update]
fn link_cold_wallet(user_id: UserId) -> Result<(), String> {
    mutate(|state| state.link_cold_wallet(raw_caller(state)?, user_id))
}

#[update]
fn unlink_cold_wallet() -> Result<(), String> {
    mutate(|state| state.unlink_cold_wallet(raw_caller(state)?))
}

#[export_name = "canister_update withdraw_rewards"]
fn withdraw_rewards() {
    spawn(async {
        reply(State::withdraw_rewards(read(caller)).await);
    })
}

#[export_name = "canister_update tip"]
fn tip() {
    let (post_id, amount): (PostId, u64) = parse(&arg_data_raw());
    reply(mutate(|state| {
        state.tip(raw_caller(state)?, post_id, amount)
    }));
}

#[export_name = "canister_update react"]
fn react() {
    let (post_id, reaction): (PostId, u16) = parse(&arg_data_raw());
    mutate(|state| reply(state.react(caller(state), post_id, reaction, api::time())));
}

#[export_name = "canister_update update_last_activity"]
fn update_last_activity() {
    mutate(|state| {
        if let Some(user) = state.principal_to_user_mut(caller(state)) {
            user.last_activity = api::time()
        }
    });
    reply_raw(&[]);
}

#[export_name = "canister_update request_principal_change"]
fn request_principal_change() {
    let new_principal: String = parse(&arg_data_raw());
    reply(mutate(|state| {
        state.request_principal_change(raw_caller(state)?, new_principal)
    }))
}

#[export_name = "canister_update confirm_principal_change"]
fn confirm_principal_change() {
    reply(mutate(|state| state.change_principal(raw_caller(state)?)));
}

#[export_name = "canister_update update_user"]
fn update_user() {
    let (new_name, about, principals, filter, governance, mode, show_posts_in_realms, pfp): (
        String,
        String,
        Vec<String>,
        UserFilter,
        bool,
        Mode,
        bool,
        Pfp,
    ) = parse(&arg_data_raw());
    reply(User::update(
        read(caller),
        optional(new_name),
        about,
        principals,
        filter,
        governance,
        mode,
        show_posts_in_realms,
        pfp,
    ))
}

#[export_name = "canister_update update_user_settings"]
fn update_user_settings() {
    let settings: std::collections::BTreeMap<String, String> = parse(&arg_data_raw());
    reply(User::update_settings(read(caller), settings))
}

#[export_name = "canister_update update_wallet_tokens"]
fn update_wallet_tokens() {
    let ids: HashSet<CanisterId> = parse(&arg_data_raw());
    reply(User::update_wallet_tokens(read(caller), ids))
}

#[export_name = "canister_update create_feature"]
fn create_feature() {
    let post_id: PostId = parse(&arg_data_raw());
    reply(features::create_feature(read(caller), post_id));
}

#[export_name = "canister_update toggle_feature_support"]
fn toggle_feature_support() {
    let post_id: PostId = parse(&arg_data_raw());
    reply(features::toggle_feature_support(read(caller), post_id));
}

#[export_name = "canister_update create_user"]
fn create_user() {
    let (name, invite): (String, String) = parse(&arg_data_raw());
    spawn(async {
        reply(match read(raw_caller) {
            Ok(caller) => user::create_user(caller, name, optional(invite)).await,
            Err(err) => Err(err),
        })
    });
}

#[export_name = "canister_update transfer_credits"]
fn transfer_credits() {
    let (recipient, amount): (UserId, Credits) = parse(&arg_data_raw());
    reply(mutate(|state| {
        let sender = state
            .principal_to_user(caller(state))
            .ok_or("user not found")?;

        sender.validate_send_credits(state)?;

        let recipient_name = &state.users.get(&recipient).ok_or("user not found")?.name;
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

#[export_name = "canister_update mint_credits_with_icp"]
fn mint_credits_with_icp() {
    spawn(async {
        let kilo_credits: u64 = parse(&arg_data_raw());
        reply(State::mint_credits_with_icp(read(caller), kilo_credits).await)
    });
}

#[export_name = "canister_update mint_credits_with_btc"]
fn mint_credits_with_btc() {
    spawn(async { reply(State::mint_credits_with_btc(read(caller)).await) });
}

#[export_name = "canister_update create_invite"]
fn create_invite() {
    let (credits, credits_per_user, realm_id): (Credits, Option<Credits>, Option<RealmId>) =
        parse(&arg_data_raw());
    mutate(|state| reply(state.create_invite(caller(state), credits, credits_per_user, realm_id)));
}

#[export_name = "canister_update update_invite"]
fn update_invite() {
    let (invite_code, credits, realm_id): (String, Option<Credits>, Option<RealmId>) =
        parse(&arg_data_raw());

    mutate(|state| reply(state.update_invite(caller(state), invite_code, credits, realm_id)));
}

#[export_name = "canister_update delay_weekly_chores"]
fn delay_weekly_chores() {
    reply(mutate(|state| state.delay_weekly_chores(caller(state))))
}

#[export_name = "canister_update create_proposal"]
fn create_proposal() {
    let (post_id, payload): (PostId, Payload) = parse(&arg_data_raw());
    reply(mutate(|state| {
        proposals::create_proposal(state, raw_caller(state)?, post_id, payload, time())
    }))
}

#[update]
fn propose_release(
    post_id: PostId,
    commit: String,
    features: Vec<PostId>,
    binary: ByteBuf,
) -> Result<u32, String> {
    mutate(|state| {
        proposals::create_proposal(
            state,
            raw_caller(state)?,
            post_id,
            proposals::Payload::Release(Release {
                commit,
                binary: binary.to_vec(),
                hash: Default::default(),
                closed_features: features,
            }),
            time(),
        )
    })
}

#[export_name = "canister_update vote_on_proposal"]
fn vote_on_proposal() {
    let (proposal_id, vote, data): (u32, bool, String) = parse(&arg_data_raw());
    reply(mutate(|state| {
        proposals::vote_on_proposal(state, time(), raw_caller(state)?, proposal_id, vote, &data)
    }))
}

#[export_name = "canister_update cancel_proposal"]
fn cancel_proposal() {
    let proposal_id: u32 = parse(&arg_data_raw());
    reply(mutate(|state| {
        proposals::cancel_proposal(state, raw_caller(state)?, proposal_id);
        Ok::<(), String>(())
    }));
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
            caller(state),
            api::time(),
            parent,
            realm,
            extension,
        )
    })?;
    Post::save_blobs(post_id, blobs).await.map(|_| post_id)
}

#[update]
/// This method initiates an asynchronous post creation.
fn add_post_data(body: String, realm: Option<RealmId>, extension: Option<Blob>) {
    let realm_len = realm.as_ref().map(|id| id.len()).unwrap_or_default();
    let blob_len = extension
        .as_ref()
        .map(|blob| blob.len())
        .unwrap_or_default();
    if blob_len > CONFIG.max_blob_size_bytes || realm_len > CONFIG.max_realm_name {
        return;
    }

    mutate(|state| {
        if let Some(user) = state.principal_to_user_mut(caller(state)) {
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
    if blob.is_empty() || blob.len() > CONFIG.max_blob_size_bytes {
        return Err("blob too big".into());
    }

    mutate(|state| {
        if let Some(user) = state.principal_to_user_mut(caller(state)) {
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
            .principal_to_user_mut(caller(state))
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
    Post::edit(id, body, blobs, patch, realm, read(caller), api::time()).await
}

#[export_name = "canister_update delete_post"]
fn delete_post() {
    mutate(|state| {
        let (post_id, versions): (PostId, Vec<String>) = parse(&arg_data_raw());
        reply(state.delete_post(caller(state), post_id, versions))
    });
}

#[export_name = "canister_update toggle_bookmark"]
fn toggle_bookmark() {
    mutate(|state| {
        let post_id: PostId = parse(&arg_data_raw());
        if let Some(user) = state.principal_to_user_mut(caller(state)) {
            reply(user.toggle_bookmark(post_id));
            return;
        };
        reply(false);
    });
}

#[export_name = "canister_update toggle_pinned_post"]
fn toggle_pinned_post() {
    mutate(|state| {
        let post_id: PostId = parse(&arg_data_raw());
        if let Some(user) = state.principal_to_user_mut(caller(state)) {
            reply(user.toggle_pinned_post(post_id));
            return;
        };
        reply(false);
    });
}

#[export_name = "canister_update toggle_following_post"]
fn toggle_following_post() {
    let post_id: PostId = parse(&arg_data_raw());
    let user_id = read(|state| {
        state
            .principal_to_user(caller(state))
            .expect("user not found")
            .id
    });
    reply(
        mutate(|state| Post::mutate(state, &post_id, |post| Ok(post.toggle_following(user_id))))
            .unwrap_or_default(),
    )
}

#[export_name = "canister_update toggle_following_user"]
fn toggle_following_user() {
    let followee_id: UserId = parse(&arg_data_raw());
    mutate(|state| reply(state.toggle_following_user(caller(state), followee_id)))
}

#[export_name = "canister_update toggle_following_feed"]
fn toggle_following_feed() {
    mutate(|state| {
        let tags: Vec<String> = parse(&arg_data_raw());
        reply(
            state
                .principal_to_user_mut(caller(state))
                .map(|user| user.toggle_following_feed(&tags))
                .unwrap_or_default(),
        )
    })
}

#[export_name = "canister_update edit_realm"]
fn edit_realm() {
    mutate(|state| {
        let (name, realm): (String, Realm) = parse(&arg_data_raw());
        reply(state.edit_realm(caller(state), name, realm))
    })
}

#[export_name = "canister_update realm_clean_up"]
fn realm_clean_up() {
    mutate(|state| {
        let (post_id, reason): (PostId, String) = parse(&arg_data_raw());
        reply(clean_up_realm(state, caller(state), post_id, reason))
    });
}

#[export_name = "canister_update create_realm"]
fn create_realm() {
    mutate(|state| {
        let (name, realm): (String, Realm) = parse(&arg_data_raw());
        reply(realms::create_realm(state, caller(state), name, realm))
    })
}

#[export_name = "canister_update toggle_realm_membership"]
fn toggle_realm_membership() {
    mutate(|state| {
        let realm_id: RealmId = parse(&arg_data_raw());
        reply(state.toggle_realm_membership(caller(state), realm_id))
    })
}

#[export_name = "canister_update toggle_blacklist"]
fn toggle_blacklist() {
    mutate(|state| {
        let user_id: UserId = parse(&arg_data_raw());
        if let Some(user) = state.principal_to_user_mut(caller(state)) {
            user.toggle_blacklist(user_id);
        }
    });
    reply_raw(&[])
}

#[export_name = "canister_update toggle_filter"]
fn toggle_filter() {
    mutate(|state| {
        let (filter, value): (String, String) = parse(&arg_data_raw());
        reply(
            if let Some(user) = state.principal_to_user_mut(caller(state)) {
                user.toggle_filter(filter, value)
            } else {
                Err("user not found".into())
            },
        );
    })
}

#[update]
async fn set_emergency_release(binary: ByteBuf) {
    mutate(|state| {
        if binary.is_empty()
            || state
                .principal_to_user(raw_caller(state).unwrap())
                .map(|user| user.account_age(WEEK) < CONFIG.min_stalwart_account_age_weeks)
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
        let principal = raw_caller(state).unwrap();
        if let Some(user) = state.principal_to_user(principal) {
            let user_balance = user.balance;
            let user_cold_balance = user.cold_balance;
            let user_cold_wallet = user.cold_wallet;
            let hash: String = parse(&arg_data_raw());
            use sha2::{Digest, Sha256};
            let mut hasher = Sha256::new();
            hasher.update(&state.emergency_binary);
            if hash == format!("{:x}", hasher.finalize()) {
                state.emergency_votes.insert(principal, user_balance);
                if let Some(principal) = user_cold_wallet {
                    state.emergency_votes.insert(principal, user_cold_balance);
                }
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

#[export_name = "canister_update create_bid"]
fn create_bid() {
    spawn(async {
        let (amount, e8s_per_token): (u64, u64) = parse(&arg_data_raw());
        reply(auction::create_bid(read(caller), amount, e8s_per_token).await)
    });
}

#[export_name = "canister_update cancel_bid"]
fn cancel_bid() {
    spawn(async { reply(auction::cancel_bid(read(caller)).await) });
}

#[update]
fn backup() {
    mutate(|state| state.create_backup())
}

#[test]
fn check_candid_interface_compatibility() {
    use candid_parser::utils::{service_equal, CandidSource};

    fn source_to_str(source: &CandidSource) -> String {
        match source {
            CandidSource::File(f) => std::fs::read_to_string(f).unwrap_or_else(|_| "".to_string()),
            CandidSource::Text(t) => t.to_string(),
        }
    }

    fn check_service_equal(new_name: &str, new: CandidSource, old_name: &str, old: CandidSource) {
        let new_str = source_to_str(&new);
        let old_str = source_to_str(&old);
        match service_equal(new, old) {
            Ok(_) => {}
            Err(e) => {
                eprintln!(
                    "{} is not compatible with {}!\n\n\
            {}:\n\
            {}\n\n\
            {}:\n\
            {}\n",
                    new_name, old_name, new_name, new_str, old_name, old_str
                );
                panic!("{:?}", e);
            }
        }
    }

    candid::export_service!();
    let new_interface = __export_service();

    // check the public interface against the actual one
    let old_interface =
        std::path::PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap()).join("taggr.did");

    check_service_equal(
        "actual candid interface",
        candid_parser::utils::CandidSource::Text(&new_interface),
        "declared candid interface in taggr.did file",
        candid_parser::utils::CandidSource::File(old_interface.as_path()),
    );
}
