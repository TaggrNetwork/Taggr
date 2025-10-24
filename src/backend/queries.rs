use crate::env::{invoices::principal_to_subaccount, proposals::Payload, realms::RealmId};

use super::*;
use candid::Principal;
use env::{
    config::CONFIG,
    memory,
    post::{Post, PostId},
    user::UserId,
    State,
};
use ic_cdk::api::{self, call::arg_data_raw};
use ic_cdk_macros::query;
use ic_ledger_types::AccountIdentifier;
use serde_bytes::ByteBuf;

// Returns the delegate principal if one exists or returns the canonical one otherwise.
fn caller(state: &State) -> Principal {
    let canonical_principal = ic_cdk::caller();
    delegations::resolve_delegation(state, canonical_principal).unwrap_or(canonical_principal)
}

#[export_name = "canister_query check_invite"]
fn check_invite() {
    let code: String = parse(&arg_data_raw());
    reply(read(|state| state.invite_codes.contains_key(&code)))
}

#[export_name = "canister_query migration_pending"]
fn migration_pending() {
    read(|state| {
        reply(state.principal_change_requests.contains_key(&caller(state)));
    });
}

#[export_name = "canister_query auction"]
fn auction() {
    read(|state| {
        reply((
            &state.auction,
            // user's canister subaccount for the ICP deposit
            AccountIdentifier::new(&id(), &principal_to_subaccount(&caller(state))).to_string(),
        ))
    })
}

#[export_name = "canister_query features"]
fn features() {
    read(|state| {
        let ids: Vec<PostId> = parse(&arg_data_raw());
        reply(
            features::features(state, &ids)
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
            match state.principal_to_user(caller(state)) {
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
                .collect::<Vec<(&u32, _)>>(),
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

/// Returns a paginated list of proposals.
///
/// # Parameters
/// - `page`: The page number for pagination (0-indexed)
/// - `filter`: Filter by proposal type. Valid values:
///   - `"ALL"`: Return all proposals
///   - `"RELEASE"`: Return only release proposals
///   - `"ICP TRANSFER"`: Return only ICP transfer proposals
///   - `"REALM CONTROLLER"`: Return only realm controller proposals
///   - `"FUNDING"`: Return only funding proposals
///   - `"REWARDS"`: Return only rewards proposals
#[export_name = "canister_query proposals"]
fn proposals() {
    let (page, filter): (usize, String) = parse(&arg_data_raw());
    read(|state| {
        reply(
            state
                .proposals
                .iter()
                .rev()
                .filter(|proposal| {
                    let payload_type = match &proposal.payload {
                        Payload::Release(_) => "RELEASE",
                        Payload::ICPTransfer(_, _) => "ICP TRANSFER",
                        Payload::AddRealmController(_, _) => "REALM CONTROLLER",
                        Payload::Funding(_, _) => "FUNDING",
                        Payload::Rewards(_) => "REWARDS",
                        Payload::Noop => return false,
                    };
                    filter == "ALL" || payload_type == filter
                })
                .skip(page * CONFIG.feed_page_size)
                .take(CONFIG.feed_page_size)
                .filter_map(|proposal| Post::get(state, &proposal.post_id))
                .map(|post| post.with_meta(state))
                .collect::<Vec<_>>(),
        )
    })
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

#[export_name = "canister_query domains"]
fn domains() {
    read(|state| reply(&state.domains))
}

#[export_name = "canister_query all_realms"]
fn all_realms() {
    let page_size = 20;
    let (domain, order, page): (String, String, usize) = parse(&arg_data_raw());
    mutate(|state| {
        reply(
            state
                .sorted_realms(domain, order)
                .skip(page * page_size)
                .take(page_size)
                .collect::<Vec<_>>(),
        );
    })
}

#[export_name = "canister_query user_posts"]
fn user_posts() {
    let (domain, handle, page, offset): (String, String, usize, PostId) = parse(&arg_data_raw());
    read(|state| {
        resolve_handle(state, Some(&handle)).map(|user| {
            reply(
                user.posts(Some(&domain), state, offset, true)
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
    let (domain, handle, page, offset): (String, String, usize, PostId) = parse(&arg_data_raw());
    read(|state| {
        resolve_handle(state, Some(&handle)).map(|user| {
            reply(
                user.posts(Some(&domain), state, offset, true)
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
    let (domain, handle, page, offset): (String, String, usize, PostId) = parse(&arg_data_raw());
    let tag = format!("@{}", handle);
    read(|state| {
        reply(
            state
                .last_posts(domain, None, offset, 0, false)
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
    let (domain, input): (String, Vec<String>) = parse(&arg_data_raw());
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
        if let Some(cfg) = state.domains.get(&domain) {
            user.realms.retain(|id| cfg.realm_visible(id));
            user.controlled_realms.retain(|id| cfg.realm_visible(id));
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
    read(|state| reply(invite::invites_by_principal(state, caller(state)).collect::<Vec<_>>()));
}

fn personal_filter(
    state: &State,
    realm: Option<&RealmId>,
    user: Option<&User>,
    post: &Post,
) -> bool {
    user.map(|user| user.should_see(state, realm, post))
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
    let (domain, handle, page, offset): (String, String, usize, PostId) = parse(&arg_data_raw());
    read(|state| {
        reply(
            state
                .user(&handle)
                .map(|user| {
                    user.posts(Some(&domain), state, offset, false)
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
    let (domain, page, offset): (String, usize, PostId) = parse(&arg_data_raw());
    read(|state| {
        reply(
            state
                .hot_posts(
                    domain,
                    None,
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
    let (domain, realm, page, offset, filtered): (String, String, usize, PostId, bool) =
        parse(&arg_data_raw());
    let realm = optional(realm);
    read(|state| {
        let user = state.principal_to_user(caller(state));
        reply(
            state
                .hot_posts(domain, realm.as_ref(), offset, None)
                .filter(|post| !filtered || personal_filter(state, realm.as_ref(), user, post))
                .skip(page * CONFIG.feed_page_size)
                .take(CONFIG.feed_page_size)
                .map(|post| post.with_meta(state))
                .collect::<Vec<_>>(),
        )
    });
}

#[export_name = "canister_query realms_posts"]
fn realms_posts() {
    let (domain, page, offset): (String, usize, PostId) = parse(&arg_data_raw());
    read(|state| {
        let user = state.principal_to_user(caller(state));
        reply(
            state
                .realms_posts(domain, caller(state), offset)
                .filter(|post| personal_filter(state, None, user, post))
                .skip(page * CONFIG.feed_page_size)
                .take(CONFIG.feed_page_size)
                .map(|post| post.with_meta(state))
                .collect::<Vec<_>>(),
        )
    });
}

#[export_name = "canister_query last_posts"]
fn last_posts() {
    let (domain, realm, page, offset, filtered): (String, String, usize, PostId, bool) =
        parse(&arg_data_raw());
    let realm = optional(realm);
    read(|state| {
        let user = state.principal_to_user(caller(state));
        reply(
            state
                .last_posts(
                    domain,
                    realm.as_ref(),
                    offset,
                    0,
                    /* with_comments = */ false,
                )
                .filter(|post| !filtered || personal_filter(state, realm.as_ref(), user, post))
                .skip(page * CONFIG.feed_page_size)
                .take(CONFIG.feed_page_size)
                .map(|post| post.with_meta(state))
                .collect::<Vec<_>>(),
        )
    });
}

#[export_name = "canister_query posts_by_tags"]
fn posts_by_tags() {
    let (domain, realm, tags_and_users, page, offset): (
        String,
        String,
        Vec<String>,
        usize,
        PostId,
    ) = parse(&arg_data_raw());
    read(|state| {
        reply(
            state
                .posts_by_tags_and_users(&domain, optional(realm), offset, &tags_and_users, false)
                .skip(page * CONFIG.feed_page_size)
                .take(CONFIG.feed_page_size)
                .map(|post| post.with_meta(state))
                .collect::<Vec<_>>(),
        )
    });
}

#[export_name = "canister_query personal_feed"]
fn personal_feed() {
    let (domain, page, offset): (String, usize, PostId) = parse(&arg_data_raw());
    read(|state| {
        reply(match state.principal_to_user(caller(state)) {
            None => Default::default(),
            Some(user) => user
                .personal_feed(domain, state, offset)
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
    let (domain, realm, n): (String, String, usize) = parse(&arg_data_raw());
    let realm = optional(realm);
    read(|state| reply(state.recent_tags(domain, realm.as_ref(), n)));
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
    let (domain, query): (String, String) = parse(&arg_data_raw());
    read(|state| reply(env::search::search(domain, state, query)));
}

#[export_name = "canister_query proposal_escrow_balance_required"]
fn proposal_escrow_balance_required() {
    reply(read(|state| {
        state.proposal_escrow_balance_required(caller(state))
    }))
}

#[export_name = "canister_query realm_search"]
fn realm_search() {
    let (domain, order, query): (String, String, String) = parse(&arg_data_raw());
    // It's ok to mutate the data to avoid cloning, because we're in a query method.
    mutate(|state| {
        let ids = state
            .sorted_realms(domain, order)
            .map(|(id, _)| id.clone())
            .collect::<Vec<_>>();
        reply(env::search::realm_search(state, ids, query))
    })
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
        None => Some(state.principal_to_user(caller(state))?),
    }
}
