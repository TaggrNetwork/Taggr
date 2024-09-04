use std::cmp::Reverse;
use std::collections::BTreeMap;

use crate::env::{invoices::principal_to_subaccount, proposals::Payload, user::UserFilter};

use super::*;
use candid::Principal;
use env::{
    config::CONFIG,
    memory,
    post::{Post, PostId},
    user::UserId,
    State,
};
use ic_cdk::{
    api::{self, call::arg_data_raw},
    caller,
};
use ic_cdk_macros::query;
use ic_ledger_types::AccountIdentifier;
use serde_bytes::ByteBuf;

#[export_name = "canister_query check_invite"]
fn check_invite() {
    let code: String = parse(&arg_data_raw());
    read(|state| reply(state.invites.contains_key(&code)))
}

#[export_name = "canister_query migration_pending"]
fn migration_pending() {
    read(|state| {
        reply(state.principal_change_requests.contains_key(&caller()));
    });
}

#[export_name = "canister_query auction"]
fn auction() {
    read(|state| {
        reply((
            &state.auction,
            // user's canister subaccount for the ICP deposit
            AccountIdentifier::new(&id(), &principal_to_subaccount(&caller())).to_string(),
        ))
    })
}

#[export_name = "canister_query features"]
fn features() {
    read(|state| {
        let ids: Vec<PostId> = parse(&arg_data_raw());
        reply(
            features::features(state, ids)
                .map(|(post_id, tokens, feature)| {
                    Post::get(state, &post_id).map(|post| (post.with_meta(state), tokens, feature))
                })
                .collect::<Vec<_>>(),
        )
    });
}

#[export_name = "canister_query distribution"]
fn distribution() {
    read(|state| {
        reply(&state.distribution_reports);
    });
}

/// Loads the user names for given ids or a speculative list of user name that could be relevant
/// for the caller: followers, followees, users from engagements and so on.
#[export_name = "canister_query users_data"]
fn users_data() {
    read(|state| {
        let ids: Vec<UserId> = parse(&arg_data_raw());
        let iter: Box<dyn Iterator<Item = &UserId>> = if ids.is_empty() {
            match state.principal_to_user(caller()) {
                Some(user) => Box::new(user.followees.iter().chain(user.followers.iter())),
                _ => Box::new(std::iter::empty()),
            }
        } else {
            Box::new(ids.iter())
        };

        reply(
            iter.filter_map(|id| state.users.get(id))
                .map(|user| (user.id, &user.name))
                .collect::<HashMap<_, _>>(),
        );
    });
}

#[export_name = "canister_query balances"]
fn balances() {
    read(|state| {
        reply(
            state
                .balances
                .iter()
                .map(|(acc, balance)| {
                    (
                        acc,
                        balance,
                        state
                            .principal_to_user(acc.owner)
                            .or(state.user(&acc.owner.to_string()))
                            .map(|u| u.id),
                    )
                })
                .collect::<Vec<_>>(),
        );
    });
}

#[export_name = "canister_query transaction"]
fn transaction() {
    let id: u32 = parse(&arg_data_raw());
    read(|state| reply(state.memory.ledger.get(&id).ok_or("not found")));
}

#[export_name = "canister_query transactions"]
fn transactions() {
    let (page, principal, subaccount): (usize, String, String) = parse(&arg_data_raw());
    read(|state| {
        let iter = state.memory.ledger.iter();
        let owner = Principal::from_text(principal).expect("invalid principal");
        let subaccount = hex::decode(subaccount).expect("invalid subaccount");
        let iter: Box<dyn DoubleEndedIterator<Item = _>> = if Principal::anonymous() == owner {
            Box::new(iter)
        } else {
            Box::new(iter.filter(|(_, t)| {
                t.to.owner == owner
                    && (t.to.subaccount.is_none() || t.to.subaccount.as_ref() == Some(&subaccount))
                    || t.from.owner == owner
                        && (t.from.subaccount.is_none()
                            || t.from.subaccount.as_ref() == Some(&subaccount))
            }))
        };
        reply(
            iter.rev()
                .skip(page * CONFIG.feed_page_size)
                .take(CONFIG.feed_page_size)
                .collect::<Vec<(u32, _)>>(),
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
    let page: usize = parse(&arg_data_raw());
    read(|state| {
        reply(
            state
                .proposals
                .iter()
                .rev()
                .skip(page * CONFIG.feed_page_size)
                .take(CONFIG.feed_page_size)
                .filter_map(|proposal| Post::get(state, &proposal.post_id))
                .map(|post| post.with_meta(state))
                .collect::<Vec<_>>(),
        )
    })
}

fn sorted_realms(
    state: &State,
    order: String,
) -> Box<dyn Iterator<Item = (&'_ String, &'_ Realm)> + '_> {
    let realm_vp = read(|state| {
        state
            .users
            .values()
            .fold(BTreeMap::default(), |mut acc, user| {
                let vp = (user.total_balance() as f32).sqrt() as u64;
                user.realms.iter().for_each(|realm_id| {
                    acc.entry(realm_id.clone())
                        .and_modify(|realm_vp| *realm_vp += vp)
                        .or_insert(vp);
                });
                acc
            })
    });
    let mut realms = state.realms.iter().collect::<Vec<_>>();
    if order != "name" {
        realms.sort_unstable_by_key(|(realm_id, realm)| match order.as_str() {
            "popularity" => {
                let realm_vp = realm_vp.get(realm_id.as_str()).copied().unwrap_or(1);
                let vp = if realm.whitelist.is_empty() {
                    realm_vp
                } else {
                    1
                };
                let moderation = if realm.filter == UserFilter::default() {
                    1
                } else {
                    realm_vp
                };
                Reverse(
                    vp * moderation
                        + (realm.num_members as f32).sqrt() as u64
                        + (realm.posts.len() as f32).sqrt() as u64,
                )
            }
            _ => Reverse(realm.last_update),
        });
    }
    Box::new(realms.into_iter())
}

#[export_name = "canister_query realms"]
fn realms() {
    let realm_ids: Vec<String> = parse(&arg_data_raw());
    mutate(|state| {
        reply(
            realm_ids
                .into_iter()
                .filter_map(|realm_id| {
                    state.realms.remove(&realm_id).map(|mut realm| {
                        realm.num_posts = realm.posts.len();
                        realm.posts.clear();
                        realm
                    })
                })
                .collect::<Vec<_>>(),
        )
    })
}

#[export_name = "canister_query all_realms"]
fn all_realms() {
    let page_size = 20;
    read(|state| {
        let (order, page): (String, usize) = parse(&arg_data_raw());
        reply(
            sorted_realms(state, order)
                .skip(page * page_size)
                .take(page_size)
                .collect::<Vec<_>>(),
        );
    })
}

#[export_name = "canister_query user_posts"]
fn user_posts() {
    let (handle, page, offset): (String, usize, PostId) = parse(&arg_data_raw());
    read(|state| {
        resolve_handle(state, Some(&handle)).map(|user| {
            reply(
                user.posts(state, offset, true)
                    .skip(CONFIG.feed_page_size * page)
                    .take(CONFIG.feed_page_size)
                    .map(|post| post.with_meta(state))
                    .collect::<Vec<_>>(),
            )
        })
    });
}

#[export_name = "canister_query rewarded_posts"]
fn rewarded_posts() {
    let (handle, page, offset): (String, usize, PostId) = parse(&arg_data_raw());
    read(|state| {
        resolve_handle(state, Some(&handle)).map(|user| {
            reply(
                user.posts(state, offset, true)
                    .filter(|post| !post.reactions.is_empty())
                    .skip(CONFIG.feed_page_size * page)
                    .take(CONFIG.feed_page_size)
                    .map(|post| post.with_meta(state))
                    .collect::<Vec<_>>(),
            )
        })
    });
}

#[export_name = "canister_query user_tags"]
fn user_tags() {
    let (handle, page, offset): (String, usize, PostId) = parse(&arg_data_raw());
    let tag = format!("@{}", handle);
    read(|state| {
        reply(
            state
                .last_posts(None, offset, 0, false)
                .filter(|post| post.body.contains(&tag))
                .skip(CONFIG.feed_page_size * page)
                .take(CONFIG.feed_page_size)
                .map(|post| post.with_meta(state))
                .collect::<Vec<_>>(),
        )
    });
}

#[export_name = "canister_query user"]
fn user() {
    let input: Vec<String> = parse(&arg_data_raw());
    let own_profile_fetch = input.is_empty();
    mutate(|state| {
        let handle = input.into_iter().next();
        let user_id = match resolve_handle(state, handle.as_ref()) {
            Some(value) => value.id,
            _ => return reply(None as Option<User>),
        };
        let user = state.users.get_mut(&user_id).expect("user not found");
        user.num_posts = user.posts.len();
        user.posts.clear();
        if own_profile_fetch {
            user.accounting.clear();
        } else {
            user.bookmarks.clear();
            user.notifications.clear();
        }
        reply(user);
    });
}

#[export_name = "canister_query tags_cost"]
fn tags_cost() {
    let tags: Vec<String> = parse(&arg_data_raw());
    read(|state| reply(state.tags_cost(Box::new(tags.iter()))))
}

#[export_name = "canister_query invites"]
fn invites() {
    read(|state| reply(state.invites(caller())));
}

fn personal_filter(state: &State, user: Option<&User>, post: &Post) -> bool {
    user.map(|user| user.should_see(state, post))
        .unwrap_or(true)
}

#[export_name = "canister_query posts"]
fn posts() {
    let ids: Vec<PostId> = parse(&arg_data_raw());
    read(|state| {
        reply(
            ids.into_iter()
                .filter_map(|id| Post::get(state, &id))
                .map(|post| post.with_meta(state))
                .collect::<Vec<_>>(),
        );
    })
}

#[export_name = "canister_query journal"]
fn journal() {
    let (handle, page, offset): (String, usize, PostId) = parse(&arg_data_raw());
    read(|state| {
        reply(
            state
                .user(&handle)
                .map(|user| {
                    user.posts(state, offset, false)
                        .filter(|post| !post.is_deleted() && !post.body.starts_with('@'))
                        .skip(page * CONFIG.feed_page_size)
                        .take(CONFIG.feed_page_size)
                        .map(|post| post.with_meta(state))
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default(),
        );
    })
}

#[export_name = "canister_query hot_realm_posts"]
fn hot_realm_posts() {
    let (realm, page, offset): (String, usize, PostId) = parse(&arg_data_raw());
    read(|state| {
        reply(
            state
                .hot_posts(
                    optional(realm),
                    offset,
                    Some(&|post: &Post| post.realm.is_some()),
                )
                .skip(page * CONFIG.feed_page_size)
                .take(CONFIG.feed_page_size)
                .map(|post| post.with_meta(state))
                .collect::<Vec<_>>(),
        )
    });
}

#[export_name = "canister_query hot_posts"]
fn hot_posts() {
    let (realm, page, offset, filtered): (String, usize, PostId, bool) = parse(&arg_data_raw());
    read(|state| {
        let user = state.principal_to_user(caller());
        reply(
            state
                .hot_posts(optional(realm), offset, None)
                .filter(|post| !filtered || personal_filter(state, user, post))
                .skip(page * CONFIG.feed_page_size)
                .take(CONFIG.feed_page_size)
                .map(|post| post.with_meta(state))
                .collect::<Vec<_>>(),
        )
    });
}

#[export_name = "canister_query realms_posts"]
fn realms_posts() {
    let (page, offset): (usize, PostId) = parse(&arg_data_raw());
    read(|state| {
        let user = state.principal_to_user(caller());
        reply(
            state
                .realms_posts(caller(), offset)
                .filter(|post| personal_filter(state, user, post))
                .skip(page * CONFIG.feed_page_size)
                .take(CONFIG.feed_page_size)
                .map(|post| post.with_meta(state))
                .collect::<Vec<_>>(),
        )
    });
}

#[export_name = "canister_query last_posts"]
fn last_posts() {
    let (realm, page, offset, filtered): (String, usize, PostId, bool) = parse(&arg_data_raw());
    read(|state| {
        let user = state.principal_to_user(caller());
        reply(
            state
                .last_posts(optional(realm), offset, 0, /* with_comments = */ false)
                .filter(|post| !filtered || personal_filter(state, user, post))
                .skip(page * CONFIG.feed_page_size)
                .take(CONFIG.feed_page_size)
                .map(|post| post.with_meta(state))
                .collect::<Vec<_>>(),
        )
    });
}

#[export_name = "canister_query posts_by_tags"]
fn posts_by_tags() {
    let (realm, tags_and_users, page, offset): (String, Vec<String>, usize, PostId) =
        parse(&arg_data_raw());
    read(|state| {
        reply(
            state
                .posts_by_tags_and_users(optional(realm), offset, &tags_and_users, false)
                .skip(page * CONFIG.feed_page_size)
                .take(CONFIG.feed_page_size)
                .map(|post| post.with_meta(state))
                .collect::<Vec<_>>(),
        )
    });
}

#[export_name = "canister_query personal_feed"]
fn personal_feed() {
    let (page, offset): (usize, PostId) = parse(&arg_data_raw());
    read(|state| {
        reply(match state.principal_to_user(caller()) {
            None => Default::default(),
            Some(user) => user
                .personal_feed(state, offset)
                // TODO: pull it inside
                .filter(|post| personal_filter(state, Some(user), post))
                .skip(page * CONFIG.feed_page_size)
                .take(CONFIG.feed_page_size)
                .map(|post| post.with_meta(state))
                .collect::<Vec<_>>(),
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
                .map(|post| post.with_meta(state))
                .collect::<Vec<_>>(),
        )
    })
}

#[export_name = "canister_query recent_tags"]
fn recent_tags() {
    let (realm, n): (String, usize) = parse(&arg_data_raw());
    read(|state| reply(state.recent_tags(optional(realm), n)));
}

#[export_name = "canister_query validate_proposal"]
fn validate_proposal() {
    let payload: Payload = parse(&arg_data_raw());
    read(|state| reply(payload.validate(state)));
}

#[export_name = "canister_query validate_username"]
fn validate_username() {
    let name: String = parse(&arg_data_raw());
    read(|state| reply(state.validate_username(&name)));
}

#[export_name = "canister_query config"]
fn config() {
    reply(CONFIG);
}

#[export_name = "canister_query logs"]
fn logs() {
    read(|state| reply(state.logs().collect::<Vec<_>>()));
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
    let query: String = parse(&arg_data_raw());
    read(|state| reply(env::search::search(state, query)));
}

#[export_name = "canister_query realm_search"]
fn realm_search() {
    let query: String = parse(&arg_data_raw());
    // It's ok to mutate the data to avoid cloning, because we're in a query method.
    mutate(|state| {
        reply(
            env::search::realm_search(state, query)
                .into_iter()
                .map(|(key, realm)| {
                    realm.num_posts = realm.posts.len();
                    realm.posts.clear();
                    (key, realm)
                })
                .collect::<Vec<_>>(),
        )
    });
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
    api::stable::stable_read(offset, &mut buf);
    vec![(page, ByteBuf::from(buf))]
}

fn resolve_handle<'a>(state: &'a State, handle: Option<&'a String>) -> Option<&'a User> {
    match handle {
        Some(handle) => state.user(handle),
        None => Some(state.principal_to_user(caller())?),
    }
}
