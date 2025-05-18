use super::*;
use serde::{Deserialize, Serialize};

#[derive(Default, Deserialize, Serialize)]
pub struct SearchResult {
    pub id: PostId,
    pub user_id: UserId,
    pub generic_id: String,
    pub result: String,
    pub relevant: String,
}

const SNIPPET_LEN: usize = 100;

const MAX_RESULTS: usize = 100;

pub fn search(domain: String, state: &State, mut query: String) -> Vec<SearchResult> {
    query = query.to_lowercase();
    let mut terms = query
        .split(' ')
        .filter(|word| word.len() > 1)
        .collect::<Vec<_>>();

    terms.sort_unstable();
    let users = |prefix: String| {
        state.users.values().filter(move |user| {
            user.name
                .to_lowercase()
                .starts_with(&prefix[1..].to_lowercase())
        })
    };

    match terms.as_slice() {
        [hashtag] if hashtag.starts_with('#') => {
            let query = &hashtag[1..].to_lowercase();
            state
                .tag_indexes
                .keys()
                .filter(|tag| tag.starts_with(query))
                .map(|tag| SearchResult {
                    relevant: tag.clone(),
                    result: "tag".to_string(),
                    ..Default::default()
                })
                .take(MAX_RESULTS)
                .collect()
        }
        // search for all posts containing `word` from specified users in the specified realm
        [realm, user_name_prefix, word]
            if user_name_prefix.starts_with('@') && realm.starts_with('/') =>
        {
            let realm_id = &realm[1..].to_uppercase();
            users(user_name_prefix.to_string())
                .flat_map(|user| user.posts(Some(&domain), state, 0, true))
                .filter_map(
                    |Post {
                         id,
                         body,
                         user,
                         realm,
                         ..
                     }| {
                        if realm.as_ref() != Some(realm_id) {
                            return None;
                        }
                        let search_body = body.to_lowercase();
                        if let Some(i) = search_body.find(word) {
                            return Some(SearchResult {
                                id: *id,
                                user_id: *user,
                                relevant: snippet(body, i),
                                result: "post".to_string(),
                                ..Default::default()
                            });
                        }
                        None
                    },
                )
                .take(MAX_RESULTS)
                .collect()
        }
        // search for all posts from specified users in the specified realm
        [realm, user_name_prefix]
            if user_name_prefix.starts_with('@') && realm.starts_with('/') =>
        {
            let realm_id = &realm[1..].to_uppercase();
            users(user_name_prefix.to_string())
                .flat_map(|user| user.posts(Some(&domain), state, 0, true))
                .filter_map(
                    |Post {
                         id,
                         body,
                         user,
                         realm,
                         ..
                     }| {
                        if realm.as_ref() != Some(realm_id) {
                            return None;
                        }
                        Some(SearchResult {
                            id: *id,
                            user_id: *user,
                            relevant: snippet(body, 0),
                            result: "post".to_string(),
                            ..Default::default()
                        })
                    },
                )
                .take(MAX_RESULTS)
                .collect()
        }
        // search for all posts from specified users containing `word`
        [user_name_prefix, word] if user_name_prefix.starts_with('@') => {
            users(user_name_prefix.to_string())
                .flat_map(|user| user.posts(Some(&domain), state, 0, true))
                .filter_map(|Post { id, body, user, .. }| {
                    let search_body = body.to_lowercase();
                    if let Some(i) = search_body.find(word) {
                        return Some(SearchResult {
                            id: *id,
                            user_id: *user,
                            relevant: snippet(body, i),
                            result: "post".to_string(),
                            ..Default::default()
                        });
                    }
                    None
                })
                .take(MAX_RESULTS)
                .collect()
        }
        // search for all posts containing `word` in the specified realm
        [realm, word] if realm.starts_with('/') => {
            let realm = &realm[1..].to_uppercase();
            state
                .last_posts(domain, Some(realm), 0, 0, true)
                .filter_map(|Post { id, body, user, .. }| {
                    let search_body = body.to_lowercase();
                    if let Some(i) = search_body.find(word) {
                        return Some(SearchResult {
                            id: *id,
                            user_id: *user,
                            relevant: snippet(body, i),
                            result: "post".to_string(),
                            ..Default::default()
                        });
                    }
                    None
                })
                .take(MAX_RESULTS)
                .collect()
        }
        // search for the user only
        [user_name] if user_name.starts_with('@') => {
            let query = user_name[1..].to_lowercase();
            state
                .users
                .values()
                .filter(|user| {
                    user.previous_names
                        .iter()
                        .chain(std::iter::once(&user.name))
                        .any(|name| name.to_lowercase().starts_with(&query))
                })
                .map(|user| SearchResult {
                    id: user.id,
                    relevant: user.about.clone(),
                    result: "user".to_string(),
                    ..Default::default()
                })
                .collect()
        }
        // search for realm only
        [realm] if realm.starts_with('/') => {
            let query = &realm[1..].to_uppercase();
            state
                .realms
                .iter()
                .filter(|(realm_id, _)| realm_id.starts_with(query))
                .map(|(realm_id, realm)| SearchResult {
                    generic_id: realm_id.clone(),
                    relevant: snippet(realm.description.as_str(), 0),
                    result: "realm".to_string(),
                    ..Default::default()
                })
                .collect()
        }
        // fall back to search through everything
        _ => wildcard_search(domain, state, &query),
    }
}

fn wildcard_search(domain: String, state: &State, term: &str) -> Vec<SearchResult> {
    state
        .realms
        .iter()
        .filter_map(|(id, realm)| {
            if let Some(i) = realm.description.to_lowercase().find(term) {
                return Some(SearchResult {
                    generic_id: id.clone(),
                    relevant: snippet(realm.description.as_str(), i),
                    result: "realm".to_string(),
                    ..Default::default()
                });
            }
            None
        })
        .chain(state.last_posts(domain, None, 0, 0, true).filter_map(
            |Post { id, body, user, .. }| {
                if id.to_string() == term {
                    return Some(SearchResult {
                        id: *id,
                        user_id: *user,
                        relevant: snippet(body, 0),
                        result: "post".to_string(),
                        ..Default::default()
                    });
                }
                let search_body = body.to_lowercase();
                if let Some(i) = search_body.find(term) {
                    return Some(SearchResult {
                        id: *id,
                        user_id: *user,
                        relevant: snippet(body, i),
                        result: "post".to_string(),
                        ..Default::default()
                    });
                }
                None
            },
        ))
        .take(MAX_RESULTS)
        .collect()
}

fn snippet(value: &str, i: usize) -> String {
    let value = remove_markdown(value);
    if value.len() < SNIPPET_LEN {
        value
    } else {
        value
            .chars()
            .skip(i.saturating_sub(SNIPPET_LEN / 2))
            .skip_while(|c| c.is_alphanumeric())
            .take(SNIPPET_LEN)
            .skip_while(|c| c.is_alphanumeric())
            .collect::<String>()
    }
    .replace('\n', " ")
}

fn remove_markdown(md: &str) -> String {
    let mut result = String::new();
    let mut in_parentheses = false;
    let mut in_square_brackets = false;
    let mut after_exclamation = false;

    for ch in md.chars() {
        match ch {
            '#' | '*' | '_' | '`' => continue,
            '!' => {
                after_exclamation = true;
                continue;
            }
            '(' => {
                in_parentheses = true;
                continue;
            }
            ')' => {
                in_parentheses = false;
                after_exclamation = false;
                continue;
            }
            '[' => {
                in_square_brackets = true;
                if after_exclamation {
                    continue;
                }
            }
            ']' => {
                in_square_brackets = false;
                if after_exclamation {
                    after_exclamation = false;
                    continue;
                }
            }
            _ => {
                if !(in_parentheses || in_square_brackets && after_exclamation) {
                    result.push(ch);
                }
            }
        }
    }

    result
}

pub fn realm_search(
    state: &mut State,
    realm_ids: Vec<RealmId>,
    query: String,
) -> Vec<(String, Realm)> {
    let query = &query.to_lowercase();
    realm_ids
        .into_iter()
        .filter_map(|realm_id| {
            state
                .realms
                .remove(&realm_id)
                .map(|realm| (realm_id, realm))
        })
        .filter(|(realm_id, realm)| {
            realm_id.to_lowercase().contains(query)
                || realm.description.to_lowercase().contains(query)
        })
        // Don't show all realms, otherwise we panic on a too large reponse size
        .take(100)
        .map(|(key, mut realm)| {
            realm.num_posts = realm.posts.len();
            realm.posts.clear();
            (key, realm)
        })
        .collect()
}
