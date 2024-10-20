use crate::env::{
    proposals::{Payload, Release},
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
    },
    spawn,
};
use ic_cdk_macros::{init, post_upgrade, pre_upgrade, update};
use ic_cdk_timers::{set_timer, set_timer_interval};
use serde_bytes::ByteBuf;
use std::time::Duration;
use user::Pfp;

#[init]
fn init() {
    mutate(|state| {
        state.memory.init();
        state.timers.last_weekly = time();
        state.timers.last_daily = time();
        state.timers.last_hourly = time();
        state.auction.amount = CONFIG.weekly_auction_size_tokens_max;
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
    });

    ic_cdk::println!(
        "Post-upgrade spent {}B instructions",
        performance_counter(0) / 1000000000
    )
}

#[allow(clippy::all)]
fn sync_post_upgrade_fixtures() {
    mutate(|state| {
        state.memory.persist_allocator();
        state.memory.api.fix();
        state.memory.init();
    });
}

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
fn unlink_cold_wallet() -> Result<(), String> {
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
    let (post_id, amount): (PostId, u64) = parse(&arg_data_raw());
    reply(mutate(|state| state.tip(caller(), post_id, amount)));
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

#[export_name = "canister_update request_principal_change"]
fn request_principal_change() {
    let principal: String = parse(&arg_data_raw());
    mutate(|state| {
        let principal = Principal::from_text(principal).expect("can't parse principal");
        if principal == Principal::anonymous() || state.principals.contains_key(&principal) {
            return;
        }
        let caller = caller();
        state
            .principal_change_requests
            .retain(|_, principal| principal != &caller);
        if state.principal_change_requests.len() <= 500 {
            state.principal_change_requests.insert(principal, caller);
        }
    });
    reply_raw(&[]);
}

#[export_name = "canister_update confirm_principal_change"]
fn confirm_principal_change() {
    reply(mutate(|state| state.change_principal(caller())));
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
        caller(),
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
    reply(User::update_settings(caller(), settings))
}

#[export_name = "canister_update create_feature"]
fn create_feature() {
    let post_id: PostId = parse(&arg_data_raw());
    reply(features::create_feature(caller(), post_id));
}

#[export_name = "canister_update toggle_feature_support"]
fn toggle_feature_support() {
    let post_id: PostId = parse(&arg_data_raw());
    reply(features::toggle_feature_support(caller(), post_id));
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

#[export_name = "canister_update delay_weekly_chores"]
fn delay_weekly_chores() {
    reply(mutate(|state| state.delay_weekly_chores(caller())))
}

#[export_name = "canister_update create_proposal"]
fn create_proposal() {
    let (post_id, payload): (PostId, Payload) = parse(&arg_data_raw());
    reply(mutate(|state| {
        proposals::create_proposal(state, caller(), post_id, payload, time())
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
            caller(),
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
                .map(|user| user.toggle_following_feed(&tags))
                .unwrap_or_default(),
        )
    })
}

#[export_name = "canister_update edit_realm"]
fn edit_realm() {
    mutate(|state| {
        let (name, realm): (String, Realm) = parse(&arg_data_raw());
        reply(state.edit_realm(caller(), name, realm))
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
        let (name, realm): (String, Realm) = parse(&arg_data_raw());
        reply(state.create_realm(caller(), name, realm))
    })
}

#[export_name = "canister_update toggle_realm_membership"]
fn toggle_realm_membership() {
    mutate(|state| {
        let name: String = parse(&arg_data_raw());
        reply(state.toggle_realm_membership(caller(), name))
    })
}

#[export_name = "canister_update toggle_blacklist"]
fn toggle_blacklist() {
    mutate(|state| {
        let user_id: UserId = parse(&arg_data_raw());
        if let Some(user) = state.principal_to_user_mut(caller()) {
            user.toggle_blacklist(user_id);
        }
    });
    reply_raw(&[])
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
        reply(auction::create_bid(caller(), amount, e8s_per_token).await)
    });
}

#[export_name = "canister_update cancel_bid"]
fn cancel_bid() {
    spawn(async { reply(auction::cancel_bid(caller()).await) });
}

fn caller() -> Principal {
    let caller = ic_cdk::caller();
    assert_ne!(caller, Principal::anonymous(), "authentication required");
    caller
}

#[update]
fn backup() {
    mutate(|state| {
        if !state.backup_exists {
            env::memory::heap_to_stable(state);
            state.memory.init();
            state.backup_exists = true;
        }
    })
}

#[update]
// Backup restore method. We only allow restoring the first 75 pages of stable memory and only
// once.
fn stable_mem_recovery(input: Vec<(u64, ByteBuf)>) {
    // These hashes can be generated by restoring the backup from September 27, using the deployed
    // replica version build from that commit.
    let hashes = vec![
        /* 0 */ "f99fb568e8f5dae48279cc6c9ec0d43fac67a7521b5f1836c42a5f0038efe68c",
        /* 1 */ "79574e55d3aaee2252eb869ddb627df34f7a42fadf8b5a3a7b8d5488ae45bfef",
        /* 2 */ "7aa09eb068a50814b5692c5440628fad8de731d82898e0670ac2f1d49a2ea115",
        /* 3 */ "e310b55b22b4e3492d7329624ff1fae1b7fce4dae51e795ac4e971ec20165d3a",
        /* 4 */ "a37b2a851f8f7329777d29f5f18617a66b28c9f6693b41e3988bf047fbd13393",
        /* 5 */ "ec6ef1e5eab6003f2313517101ca6a2fe0b7f1fda0cc219b78d5b3db214b8a4a",
        /* 6 */ "479e71c570e2f8e7ec4e197b87613f35beeb2583d94ae692645a1fa7c99d50f9",
        /* 7 */ "c972a5e711640ecf48050065b6b516c5ff294d24429d6ab68d91579c69f342ec",
        /* 8 */ "786bdef851dd3aee27a19916aa78b7e0a77a11768cc240e8c28b1e4c1d32fdef",
        /* 9 */ "5467a41cdf53026dc10a5c9e018281238d2e31ab02426da71bd3a0c2681add0e",
        /* 10 */ "49ed985741eeb25b9c10c713048853a442d1a4736e2534d1d20e0c17fcb0cf52",
        /* 11 */ "b1c9a6f5e7580696a568703c5d8b328d81fd5ff5113d00a856b40f38bcd6f0f4",
        /* 12 */ "33900edff875a67ee27440d83375811f0add2b87ab215a59d5b9e0999cfd030d",
        /* 13 */ "3f518e0ce027248223a3d0abbc8d696932f19bf5cf1ced3c80a7ba4f7aae3359",
        /* 14 */ "17ce5dc0676b3c837e2a64f34550cf546a4d5306a659836cd00516e3cbde3b11",
        /* 15 */ "10578bc3172c57ae573de5ae864a548bd0e992506277ce5270cff8936b72c545",
        /* 16 */ "266ae051bb95411981b8d5009f487bd4622870ba301078e58bf879b6d2f6d57a",
        /* 17 */ "09e5a36bf15d34db580e0b8b75ef1f7f1396843ff05f186ce5bfca3978a8646a",
        /* 18 */ "a7b9a6bba5e4695de8438c3606ad1fb20cb6f4533c261ef870a2ef130241ff1d",
        /* 19 */ "e83351e3642c27be37d2b7f2afda8775906ded16ddc764184a565662bd8e8a2c",
        /* 20 */ "7cd48c52a32826b97f4162d850d559d826ceefe02f08077d8dbfe91903ef7e11",
        /* 21 */ "b531223fd65ff64dee37f6f0ec2c8373cc1e08437433c9ff4f8f8e13717dbd33",
        /* 22 */ "7ab6f1db6b856b2179a4bd7fba47a331bbf18dac2246a85b7681f594dd78e801",
        /* 23 */ "198c66bb148c97b3868d48f661403272d40ba41b7ab44bb760286ae5c29a99f6",
        /* 24 */ "344f20ffbb47bd2e844d51f7b543726bb35f31ddaea2dc940326eb1265bd1e26",
        /* 25 */ "544532c223022b520f3bec22a2abc861a6979cb32a11bc43dd6992642bba5c36",
        /* 26 */ "ca55a1e7bb1e1fc394dc18d6c5903c1ec419070eaa12ed37cde1fd18b9b1d0c0",
        /* 27 */ "70fd9ce54e87030ed60cca33ff8dc43af72c8ed78b5cb0396609d33a0c88b3ee",
        /* 28 */ "9e4dc0a368aa386355b921e9e54e9e63bf7106df42b38d83dad366c391243d3b",
        /* 29 */ "dd29e17c06f53642fcf5f3ec019ae94aec8d06e1ed81becd2a76c549f3600ead",
        /* 30 */ "b62d60f66cdef0d2996b30c1a04999241f8d47276b83debe55cf7d53f43492e9",
        /* 31 */ "4f1bcec97f409a0f5a055da6aad19002aab9c50d6a2282af42582765463f1c9d",
        /* 32 */ "d4ced8b559d28d9459205e5f0f37dc71bd279caec20f5f2f17c461a336cb10c3",
        /* 33 */ "b9d998492ccf35d62588bf05d509981c6e7eebf1c0ca92a51c6168d0a108fd11",
        /* 34 */ "892761a1bc6f7d058f51a5a2aeae75899774e7db0f506a0b5dcb51e97d137e8a",
        /* 35 */ "fcceac9cefd37c2f1fe2c86966278f4b77edea49f259602f938356ff3f2a4082",
        /* 36 */ "052982a6ccc381c169422ebef8810aa73abd9c08285afafd9dd45c1847845857",
        /* 37 */ "a9e704b9850c5087736cf8d1832b6c959ea0edbb564a18dadaae8ff240bf37a0",
        /* 38 */ "9863fdc6965b646f1f6cdbc3e63a13135cc6705eaca4076042b24b6443692075",
        /* 39 */ "bb6946baddbca6aed16c0ced6b2fa8719e9124a3aa3b9d59225e6bcd59ac8785",
        /* 40 */ "e113e814d53a1b67718d4f09fea031f2014e2abc532f27c2cfb7210861dfafef",
        /* 41 */ "fb919376f88ffb2babfe2cd2c2dbe2d3de8bec63ca70166b9af26d4205f58719",
        /* 42 */ "3a9f4c81073c52c8f40b7cf04ab7a15eda3240ad9255346ba47223a3d69764ac",
        /* 43 */ "6ecccca09f17672f219472bbe1025922cd4ba9515220cb11c5bf69c8e6ff2d5c",
        /* 44 */ "374d93fc8bec713944ac18088f24f45412c36b792dd444a1dfda4904c46723fb",
        /* 45 */ "e996c44e43b7c3b73f0f41eb084d3711f0e2a3245605d073b089cef5fa811ea6",
        /* 46 */ "4c7215c771378239df0318b62c86cd9a87a742a776c8042aa3cb074d47dd0bde",
        /* 47 */ "cf15cd372f8405d26e3125b5eb08be6ded0456f86e5c5a939dcb58246c9b7f9d",
        /* 48 */ "666b4314791227d36b75ef3c11f4faef0c84ff5e8fc2c949d1ffe8b3cc9bcb8d",
        /* 49 */ "d3832d40b8c251c6f9939abc665cad0d21b2a5a064118739c9f034b0afe66949",
        /* 50 */ "65dece48a9946bd343ead3ca50a7c2806b8acc12f28286e4ad21494ec1982631",
        /* 51 */ "bcc40851461243c8318f9864e7800a3d42a0fed68d1d994ee9ee1a201f5a97e7",
        /* 52 */ "fedc55ea57f7d06a0227c606cd1217200b632fa74e7b867fc34cdf0b699dff14",
        /* 53 */ "a76c666d417fb95d5c2b7c3ce1144556bf00cc2f0e43ca875eb3854fa0934e95",
        /* 54 */ "3d33f0f72d9734a6964c88d189698f0cb13db43560f1914176da083f419fcaeb",
        /* 55 */ "dbfa051793b67b44a42d65a671752fe26e0ad9af161dff784dda2c8863334fb5",
        /* 56 */ "c3da2254990db325f47c9307a5a7a7f38f84170e3a8ef2d9e9af5f61baeda577",
        /* 57 */ "b700a7a13363e023c50bbdc4160606c8ad5132fdce97d7351570fd2433277c7d",
        /* 58 */ "4d8d1a2e8cf788000d009ccd9c2be5cff4572ee226bfdc96f9dc2f12fc9cd0eb",
        /* 59 */ "a26250475a7b5f83d31862fbc051c1d2c9b1e91ab861f87573641af58865a71e",
        /* 60 */ "0019807968e85cca0a768ddebce962f7e903ad48bba7a9399b8df363481e904d",
        /* 61 */ "a51943c1593651b21298baacb1ab1cd1521da35b094d87164b7daf8afe8dfbac",
        /* 62 */ "8b291ff4670293559274539d66276fddf1715db06b356562fc3176e6c89d9613",
        /* 63 */ "b6f5058d4a76559d2fa675505f51c266f92c1dde1cf5e6ebc8fd6147272dc599",
        /* 64 */ "7f8f861baae4c35aca4b646892e5100367b5ee89cd5247bf3c0c97fe8471d219",
        /* 65 */ "5d375f75b8a6aeaf392cefd063b6d806953b51383d38533d949a5941b811a1ad",
        /* 66 */ "d833ccc7b102191d54a48194e185a62297e233957047b0be7d8ea8d7b41934ae",
        /* 67 */ "12c05733c4faf4deed2e665952b4138f90340a61d31f4aa5f338c24a24be27a7",
        /* 68 */ "77ca80058867c3cbea5492e3ab806a7aa3241eb4869c3167b505a0779ec69378",
        /* 69 */ "445b49ddca43ce891d1b6aa5dd225b6a5ac8a110e2e93b2eb8fe5e62a32ba39a",
        /* 70 */ "424fef81061698f1e5cf90a28ac91bdf3204191efe8f854030c30ca9a52b7fd1",
        /* 71 */ "a85fecbb13ce8a9116118a394a77e14b3606fa70925397e6958593c14711b1ea",
        /* 72 */ "bf4184d8d0709f12cb5279c564508057462b73b6a913d3f796f56332bd0a8d3b",
        /* 73 */ "62e99f00eb8cd5712097c420e66d2f23e98860f244f314a075fca490db863567",
        /* 74 */ "7b0e072489937ce47c83e137efc22b2c0c3713f59cd2331eb37c15db246b6981",
        /* 75 */ "04555cc5ce7985651ee212a3930f232170c9f4f56277dfd3cff3a6204f22d5ea",
        /* 76 */ "f15a6584b937b83134f8893d18edf23775754d130ccb15816012c30f6e6b8eac",
        /* 77 */ "5782f8e0f6a8ccf4c32f02eed73bbab49a60c64aa8fca32edc7533a5a7ad9d80",
        /* 78 */ "fb0b1120fb7f12351f6f7f918c1d33b78ee1875b2638dee29a2ef055352243da",
        /* 79 */ "b489f78da4240cd54f150fe40fb88a8ba1ff5dd84ffbab97bd079366a5ff8e47",
    ];
    use ic_cdk::api::stable;
    if let Some((page, buffer)) = input.get(0) {
        if page > &75 {
            return;
        }
        let offset = page * BACKUP_PAGE_SIZE as u64;

        // Read existing page first. If it is restored already, quit.
        let mut current_page = Vec::with_capacity(BACKUP_PAGE_SIZE as usize);
        current_page.spare_capacity_mut();
        unsafe {
            current_page.set_len(BACKUP_PAGE_SIZE as usize);
        }
        api::stable::stable_read(offset, &mut current_page);
        if ByteBuf::from(current_page) == buffer {
            ic_cdk::println!("PAGE EXISTS");
            return;
        }

        use sha2::{Digest, Sha256};

        let mut hasher = Sha256::new();
        hasher.update(&buffer);
        let result = hasher.finalize();
        let hash = format!("{:x}", result);
        if hash != hashes[*page as usize] {
            ic_cdk::println!("WRONG HASH: {}", hash);
            return;
        }

        stable::stable_write(offset, buffer);
        ic_cdk::println!("SUCCESS");
    }
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
