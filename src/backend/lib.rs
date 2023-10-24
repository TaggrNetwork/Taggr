use std::{
    cell::RefCell,
    collections::{BTreeMap, BTreeSet, HashMap},
};

use env::{
    canisters::get_full_neuron,
    config::{reaction_karma, CONFIG},
    memory,
    post::{Extension, Post, PostId},
    proposals::{Release, Reward},
    storage::Storage,
    token::account,
    user::{Draft, User, UserId},
    State, *,
};
use ic_cdk::{
    api::{
        self,
        call::{arg_data_raw, reply_raw},
    },
    caller, spawn,
};
use ic_cdk_macros::*;
use ic_cdk_timers::{set_timer, set_timer_interval};
use serde_bytes::ByteBuf;

mod assets;
#[cfg(feature = "dev")]
mod dev_features;
mod env;
mod http;
mod metadata;

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

fn set_timers() {
    set_timer(std::time::Duration::from_secs(1), || {
        spawn(State::finalize_upgrade())
    });
    set_timer_interval(std::time::Duration::from_secs(15 * 60), || {
        spawn(State::chores(api::time()))
    });
}

#[init]
fn init() {
    mutate(|state| {
        state.load();
        state.last_weekly_chores = time();
        state.last_daily_chores = time();
        state.last_hourly_chores = time();
    });
    set_timers();
    set_timer(std::time::Duration::from_secs(1), || {
        spawn(async {
            if let Err(err) = Storage::allocate_space().await {
                mutate(|state| state.logger.error(err));
            }
        })
    });
}

#[pre_upgrade]
fn pre_upgrade() {
    mutate(env::memory::heap_to_stable)
}

#[post_upgrade]
fn post_upgrade() {
    // This should prevent accidental deployments of dev releases.
    #[cfg(feature = "dev")]
    {
        let config: &str = include_str!("../../canister_ids.json");
        if config.contains(&api::id().to_string()) {
            panic!("dev feature is enabled!")
        }
    }
    stable_to_heap_core();
    mutate(|state| state.load());
    set_timers();

    // temporary post upgrade logic goes here
    // set_timer(std::time::Duration::from_secs(1), move || {
    //     spawn(post_upgrade_fixtures())
    // });
}

// async fn post_upgrade_fixtures() {}

/*
 * UPDATES
 */

#[cfg(not(feature = "dev"))]
#[update]
fn prod_release() -> bool {
    true
}

fn stable_to_heap_core() {
    STATE.with(|cell| cell.replace(env::memory::stable_to_heap()));
    mutate(|state| state.load());
}

/// Fetches the full neuron info of the TaggrDAO proving the neuron decentralization
/// and voting via hot-key capabilities.
#[update]
async fn get_neuron_info() -> Result<String, String> {
    get_full_neuron(CONFIG.neuron_id).await
}

#[export_name = "canister_update vote_on_poll"]
fn vote_on_poll() {
    let (post_id, vote): (PostId, u16) = parse(&arg_data_raw());
    mutate(|state| reply(state.vote_on_poll(caller(), api::time(), post_id, vote)));
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
        let ids: Vec<String> = parse(&arg_data_raw());
        state.clear_notifications(caller(), ids);
        reply_raw(&[]);
    })
}

#[export_name = "canister_update tip"]
fn tip() {
    spawn(async {
        let (post_id, amount): (PostId, String) = parse(&arg_data_raw());
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
    let (new_name, about, principals, settings): (String, String, Vec<String>, String) =
        parse(&arg_data_raw());
    reply(User::update(
        caller(),
        optional(new_name),
        about,
        principals,
        settings,
    ))
}

#[export_name = "canister_update create_user"]
fn create_user() {
    let (name, invite): (String, Option<String>) = parse(&arg_data_raw());
    spawn(async {
        reply(State::create_user(caller(), name, invite).await);
    });
}

#[export_name = "canister_update transfer_cycles"]
fn transfer_cycles() {
    let (recipient, amount): (UserId, Cycles) = parse(&arg_data_raw());
    reply(mutate(|state| {
        let sender = state.principal_to_user(caller()).expect("no user found");
        let recipient_name = &state.users.get(&recipient).expect("no user found").name;
        state.cycle_transfer(
            sender.id,
            recipient,
            amount,
            CONFIG.cycle_transaction_fee,
            Destination::Cycles,
            format!(
                "cycle transfer from @{} to @{}",
                sender.name, recipient_name
            ),
            Some(format!(
                "You have received `{}` cycles from @{}",
                amount, sender.name
            )),
        )
    }))
}

#[export_name = "canister_update transfer_icp"]
fn transfer_icp() {
    spawn(async {
        let (recipient, amount): (String, String) = parse(&arg_data_raw());
        reply(State::icp_transfer(caller(), recipient, &amount).await)
    });
}

#[export_name = "canister_update transfer_tokens"]
fn transfer_tokens() {
    let (recipient, amount): (String, String) = parse(&arg_data_raw());
    reply(token::user_transfer(recipient, amount))
}

#[export_name = "canister_update mint_cycles"]
fn mint_cycles() {
    spawn(async {
        let kilo_cycles: u64 = parse(&arg_data_raw());
        reply(State::mint_cycles(caller(), kilo_cycles).await)
    });
}

#[export_name = "canister_update create_invite"]
fn create_invite() {
    let cycles: Cycles = parse(&arg_data_raw());
    mutate(|state| reply(state.create_invite(caller(), cycles)));
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
            proposals::Payload::Fund(receiver, tokens * 10_u64.pow(CONFIG.token_decimals as u32)),
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
    realm: Option<String>,
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
fn add_post_data(body: String, realm: Option<String>, extension: Option<Blob>) {
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
            let cycles = user.cycles();
            if let Some(draft) = user.draft.as_mut() {
                if cycles < (draft.blobs.len() + 1) as u64 * CONFIG.blob_cost {
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
    realm: Option<String>,
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
        let (name, logo, label_color, theme, description, controllers): (
            String,
            String,
            String,
            String,
            String,
            BTreeSet<UserId>,
        ) = parse(&arg_data_raw());
        reply(state.edit_realm(
            caller(),
            name,
            logo,
            label_color,
            theme,
            description,
            controllers,
        ))
    })
}

#[export_name = "canister_update realm_clean_up"]
fn realm_clean_up() {
    mutate(|state| {
        let post_id: PostId = parse(&arg_data_raw());
        reply(state.clean_up_realm(caller(), post_id))
    });
}

#[export_name = "canister_update create_realm"]
fn create_realm() {
    mutate(|state| {
        let (name, logo, label_color, theme, description, controllers): (
            String,
            String,
            String,
            String,
            String,
            BTreeSet<UserId>,
        ) = parse(&arg_data_raw());
        reply(state.create_realm(
            caller(),
            name,
            logo,
            label_color,
            theme,
            description,
            controllers,
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
        if let Some(balance) = state.balances.get(&account(principal)) {
            let hash: String = parse(&arg_data_raw());
            use sha2::{Digest, Sha256};
            let mut hasher = Sha256::new();
            hasher.update(&state.emergency_binary);
            if hash == format!("{:x}", hasher.finalize()) {
                state.emergency_votes.insert(principal, *balance);
            }
        }
        reply_raw(&[]);
    })
}

// This function is the last resort of triggering the emergency upgrade and is expected to be used.
#[update]
fn force_emergency_upgrade() {
    mutate(|state| state.execute_pending_emergency_upgrade(true));
}

/*
 * QUERIES
 */

#[export_name = "canister_query check_invite"]
fn check_invite() {
    let code: String = parse(&arg_data_raw());
    read(|state| reply(state.invites.contains_key(&code)))
}

#[export_name = "canister_query balances"]
fn balances() {
    read(|state| {
        reply(
            state
                .balances
                .iter()
                .fold(HashMap::new(), |mut map, (account, balance)| {
                    map.entry(account.owner)
                        .and_modify(|b| *b += *balance)
                        .or_insert(*balance);
                    map
                })
                .into_iter()
                .map(|(principal, balance)| {
                    (
                        principal,
                        balance,
                        state.principal_to_user(principal).map(|u| u.id),
                    )
                })
                .collect::<Vec<_>>(),
        );
    });
}

#[export_name = "canister_query transaction"]
fn transaction() {
    let id: usize = parse(&arg_data_raw());
    read(|state| reply(state.ledger.get(id).ok_or("not found")));
}

#[export_name = "canister_query transactions"]
fn transactions() {
    let (page, search_term): (usize, String) = parse(&arg_data_raw());
    read(|state| {
        let iter = state.ledger.iter().enumerate();
        let iter: Box<dyn DoubleEndedIterator<Item = _>> = if search_term.is_empty() {
            Box::new(iter)
        } else {
            Box::new(iter.filter(|(_, t)| {
                (t.to.owner.to_string() + &t.from.owner.to_string()).contains(&search_term)
            }))
        };
        reply(
            iter.rev()
                .skip(page * CONFIG.feed_page_size)
                .take(CONFIG.feed_page_size)
                .collect::<Vec<(usize, _)>>(),
        );
    });
}

#[export_name = "canister_query proposal"]
fn proposal() {
    read(|state| {
        let id: u32 = parse(&arg_data_raw());
        reply(
            state
                .proposals
                .iter()
                .find(|proposal| proposal.id == id)
                .ok_or("no proposal found"),
        )
    })
}

#[export_name = "canister_query proposals"]
fn proposals() {
    let page_size = 10;
    let page: usize = parse(&arg_data_raw());
    read(|state| {
        reply(
            state
                .proposals
                .iter()
                .rev()
                .skip(page * page_size)
                .take(page_size)
                .filter_map(|proposal| Post::get(state, &proposal.post_id))
                .collect::<Vec<_>>(),
        )
    })
}

fn sorted_realms(state: &State) -> Vec<(&'_ String, &'_ Realm)> {
    let mut realms = state.realms.iter().collect::<Vec<_>>();
    realms.sort_unstable_by_key(|(_name, realm)| {
        std::cmp::Reverse(realm.num_posts * realm.num_members)
    });
    realms
}

#[export_name = "canister_query realms_data"]
fn realms_data() {
    read(|state| {
        let user_id = state.principal_to_user(caller()).map(|user| user.id);
        reply(
            sorted_realms(state)
                .iter()
                .map(|(name, realm)| {
                    (
                        name,
                        &realm.label_color,
                        user_id.map(|id| realm.controllers.contains(&id)),
                    )
                })
                .collect::<Vec<_>>(),
        );
    });
}

#[export_name = "canister_query realm"]
fn realm() {
    let name: String = parse(&arg_data_raw());
    read(|state| reply(state.realms.get(&name).ok_or("no realm found")));
}

#[export_name = "canister_query realms"]
fn realms() {
    read(|state| {
        let page_size = 8;
        let page: usize = parse(&arg_data_raw());
        reply(
            sorted_realms(state)
                .iter()
                .skip(page * page_size)
                .take(page_size)
                .collect::<Vec<_>>(),
        );
    })
}

#[export_name = "canister_query user_posts"]
fn user_posts() {
    let (handle, page): (String, usize) = parse(&arg_data_raw());
    read(|state| {
        resolve_handle(Some(handle)).map(|user| {
            reply(
                user.posts(state)
                    .skip(CONFIG.feed_page_size * page)
                    .take(CONFIG.feed_page_size)
                    .collect::<Vec<_>>(),
            )
        })
    });
}

#[export_name = "canister_query rewarded_posts"]
fn rewarded_posts() {
    let (handle, page): (String, usize) = parse(&arg_data_raw());
    read(|state| {
        resolve_handle(Some(handle)).map(|user| {
            reply(
                user.posts(state)
                    .filter(|post| !post.reactions.is_empty())
                    .skip(CONFIG.feed_page_size * page)
                    .take(CONFIG.feed_page_size)
                    .collect::<Vec<_>>(),
            )
        })
    });
}

#[export_name = "canister_query user_tags"]
fn user_tags() {
    let (handle, page): (String, usize) = parse(&arg_data_raw());
    let tag = format!("@{}", handle);
    read(|state| {
        reply(
            state
                .last_posts(caller(), None, true)
                .filter(|post| post.body.contains(&tag))
                .skip(CONFIG.feed_page_size * page)
                .take(CONFIG.feed_page_size)
                .collect::<Vec<_>>(),
        )
    });
}

#[export_name = "canister_query user"]
fn user() {
    let input: Vec<String> = parse(&arg_data_raw());
    let own_profile_fetch = input.is_empty();
    reply(resolve_handle(input.into_iter().next()).map(|mut user| {
        read(|state| {
            user.balance = state
                .balances
                .get(&token::account(user.principal))
                .copied()
                .unwrap_or_default();
            user.karma_donations.clear();
            if own_profile_fetch {
                user.accounting.clear();
            } else {
                let karma = reaction_karma();
                user.bookmarks.clear();
                user.settings.clear();
                user.inbox.clear();
                user.karma_from_last_posts = user
                    .posts(state)
                    .take(CONFIG.feed_page_size * 3)
                    .flat_map(|post| post.reactions.iter())
                    .flat_map(|(r_id, users)| {
                        let cost = karma.get(r_id).copied().unwrap_or_default();
                        users
                            .iter()
                            .filter(|user_id| {
                                state
                                    .users
                                    .get(user_id)
                                    .map_or(false, |user| user.trusted())
                            })
                            .map(move |user_id| (*user_id, cost))
                    })
                    .fold(BTreeMap::default(), |mut acc, (user_id, karma)| {
                        acc.entry(user_id)
                            .and_modify(|e| *e += karma)
                            .or_insert(karma);
                        acc
                    });
            }
            user
        })
    }));
}

#[export_name = "canister_query invites"]
fn invites() {
    read(|state| reply(state.invites(caller())));
}

#[export_name = "canister_query posts"]
fn posts() {
    let ids: Vec<PostId> = parse(&arg_data_raw());
    read(|state| {
        reply(
            ids.into_iter()
                .filter_map(|id| Post::get(state, &id))
                .collect::<Vec<&Post>>(),
        );
    })
}

#[export_name = "canister_query journal"]
fn journal() {
    let (handle, page): (String, usize) = parse(&arg_data_raw());
    read(|state| {
        reply(
            state
                .user(&handle)
                .map(|user| {
                    user.posts(state)
                        // we filter out responses, root posts starting with tagging another user
                        // and deletet posts
                        .filter(|post| {
                            !post.is_deleted()
                                && post.parent.is_none()
                                && !post.body.starts_with('@')
                        })
                        .skip(page * CONFIG.feed_page_size)
                        .take(CONFIG.feed_page_size)
                        .cloned()
                        .collect::<Vec<Post>>()
                })
                .unwrap_or_default(),
        );
    })
}

#[export_name = "canister_query hot_posts"]
fn hot_posts() {
    let (realm, page): (String, usize) = parse(&arg_data_raw());
    read(|state| reply(state.hot_posts(optional(realm), page)));
}

#[export_name = "canister_query realms_posts"]
fn realms_posts() {
    let page: usize = parse(&arg_data_raw());
    read(|state| reply(state.realms_posts(caller(), page)));
}

#[export_name = "canister_query last_posts"]
fn last_posts() {
    let (realm, page, with_comments): (String, usize, bool) = parse(&arg_data_raw());
    read(|state| {
        reply(
            state
                .last_posts(caller(), optional(realm), with_comments)
                .skip(page * CONFIG.feed_page_size)
                .take(CONFIG.feed_page_size)
                .cloned()
                .collect::<Vec<Post>>(),
        )
    });
}

#[export_name = "canister_query posts_by_tags"]
fn posts_by_tags() {
    let (realm, tags, users, page): (String, Vec<String>, Vec<UserId>, usize) =
        parse(&arg_data_raw());
    read(|state| {
        reply(
            state
                .posts_by_tags(caller(), optional(realm), tags, users, page)
                .into_iter()
                .collect::<Vec<Post>>(),
        )
    });
}

#[export_name = "canister_query personal_feed"]
fn personal_feed() {
    let (page, with_comments): (usize, bool) = parse(&arg_data_raw());
    read(|state| {
        reply(match state.principal_to_user(caller()) {
            None => Default::default(),
            Some(user) => user
                .personal_feed(state, page, with_comments)
                .cloned()
                .collect::<Vec<Post>>(),
        })
    });
}

#[export_name = "canister_query thread"]
fn thread() {
    let id: PostId = parse(&arg_data_raw());
    read(|state| {
        reply(
            state
                .thread(id)
                .filter_map(|id| Post::get(state, &id))
                .cloned()
                .collect::<Vec<Post>>(),
        )
    })
}

#[export_name = "canister_query validate_username"]
fn validate_username() {
    let name: String = parse(&arg_data_raw());
    read(|state| reply(state.validate_username(&name)));
}

#[export_name = "canister_query recent_tags"]
fn recent_tags() {
    let (realm, n): (String, u64) = parse(&arg_data_raw());
    read(|state| reply(state.recent_tags(caller(), optional(realm), n)));
}

#[export_name = "canister_query users"]
fn users() {
    read(|state| {
        reply(
            state
                .users
                .values()
                .map(|user| (user.id, user.name.clone(), user.karma()))
                .collect::<Vec<(UserId, String, Karma)>>(),
        )
    });
}

#[export_name = "canister_query config"]
fn config() {
    reply(CONFIG);
}

#[export_name = "canister_query logs"]
fn logs() {
    read(|state| reply(state.logs()));
}

#[export_name = "canister_query recovery_state"]
fn recovery_state() {
    read(|state| reply(state.recovery_state()));
}

#[export_name = "canister_query stats"]
fn stats() {
    read(|state| reply(state.stats(api::time())));
}

#[export_name = "canister_query search"]
fn search() {
    let term: String = parse(&arg_data_raw());
    read(|state| reply(state.search(term)));
}

#[query]
fn stable_mem_read(page: u64) -> Vec<(u64, Blob)> {
    let offset = page * BACKUP_PAGE_SIZE as u64;
    let (heap_off, heap_size) = memory::heap_address();
    let memory_end = heap_off + heap_size;
    if offset > memory_end {
        return Default::default();
    }
    let chunk_size = (BACKUP_PAGE_SIZE as u64).min(memory_end - offset) as usize;
    let mut buf = Vec::with_capacity(chunk_size);
    buf.spare_capacity_mut();
    unsafe {
        buf.set_len(chunk_size);
    }
    api::stable::stable64_read(offset, &mut buf);
    vec![(page, ByteBuf::from(buf))]
}

fn parse<'a, T: serde::Deserialize<'a>>(bytes: &'a [u8]) -> T {
    serde_json::from_slice(bytes).expect("couldn't parse the input")
}

fn reply<T: serde::Serialize>(data: T) {
    reply_raw(serde_json::json!(data).to_string().as_bytes());
}

fn resolve_handle(handle: Option<String>) -> Option<User> {
    read(|state| match handle {
        Some(handle) => state.user(&handle).cloned(),
        None => Some(state.principal_to_user(caller())?.clone()),
    })
}

fn optional(s: String) -> Option<String> {
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}
