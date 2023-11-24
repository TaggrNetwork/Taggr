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

pub fn search(state: &State, mut query: String) -> Vec<SearchResult> {
    query = query.to_lowercase();
    let mut terms = query
        .split(' ')
        .filter(|word| word.len() > 1)
        .collect::<Vec<_>>();

    terms.sort_unstable();
    let user_ids = |user_name: &str| {
        state
            .users
            .values()
            .filter(|user| {
                user.name
                    .to_lowercase()
                    .starts_with(&user_name[1..].to_lowercase())
            })
            .map(|user| user.id)
            .collect::<BTreeSet<_>>()
    };

    match terms.as_slice() {
        // search for all posts containing `word` from specified users in the specified realm
        [realm, user_name, word] if user_name.starts_with('@') && realm.starts_with('/') => {
            let realm = &realm[1..].to_uppercase();
            let ids = user_ids(user_name);
            state
                .last_posts(Principal::anonymous(), Some(realm.to_string()), true)
                .filter_map(|Post { id, body, user, .. }| {
                    if ids.contains(user) {
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
                    }
                    None
                })
                .take(MAX_RESULTS)
                .collect()
        }
        // search for all posts from specified users in the specified realm
        [realm, user_name] if user_name.starts_with('@') && realm.starts_with('/') => {
            let realm = &realm[1..].to_uppercase();
            let ids = user_ids(user_name);
            state
                .last_posts(Principal::anonymous(), Some(realm.to_string()), true)
                .filter_map(|Post { id, body, user, .. }| {
                    if ids.contains(user) {
                        return Some(SearchResult {
                            id: *id,
                            user_id: *user,
                            relevant: snippet(body, 0),
                            result: "post".to_string(),
                            ..Default::default()
                        });
                    }
                    None
                })
                .take(MAX_RESULTS)
                .collect()
        }
        // search for all posts from specified users containing `word`
        [user_name, word] if user_name.starts_with('@') => {
            let ids = user_ids(user_name);
            state
                .last_posts(Principal::anonymous(), None, true)
                .filter_map(|Post { id, body, user, .. }| {
                    if ids.contains(user) {
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
                .last_posts(Principal::anonymous(), Some(realm.to_string()), true)
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
        // fall back to search through everything
        _ => wildcard_search(state, &query),
    }
}

fn wildcard_search(state: &State, term: &str) -> Vec<SearchResult> {
    state
        .users
        .iter()
        .filter_map(
            |(
                id,
                User {
                    name,
                    about,
                    previous_names,
                    ..
                },
            )| {
                if format!("@{} {0} {} {} {:?}", name, id, about, previous_names)
                    .to_lowercase()
                    .contains(term)
                {
                    return Some(SearchResult {
                        id: *id,
                        relevant: about.clone(),
                        result: "user".to_string(),
                        ..Default::default()
                    });
                }
                None
            },
        )
        .chain(state.realms.iter().filter_map(|(id, realm)| {
            if id.to_lowercase().contains(term) {
                return Some(SearchResult {
                    generic_id: id.clone(),
                    relevant: snippet(realm.description.as_str(), 0),
                    result: "realm".to_string(),
                    ..Default::default()
                });
            }
            if let Some(i) = realm.description.to_lowercase().find(term) {
                return Some(SearchResult {
                    generic_id: id.clone(),
                    relevant: snippet(realm.description.as_str(), i),
                    result: "realm".to_string(),
                    ..Default::default()
                });
            }
            None
        }))
        .chain(
            state
                .recent_tags(Principal::anonymous(), None, 500)
                .into_iter()
                .filter_map(|(tag, _)| {
                    if format!("#{} {0}", tag).to_lowercase().contains(term) {
                        return Some(SearchResult {
                            relevant: tag,
                            result: "tag".to_string(),
                            ..Default::default()
                        });
                    }
                    None
                }),
        )
        .chain(
            state
                .last_posts(Principal::anonymous(), None, true)
                .filter_map(|Post { id, body, user, .. }| {
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
                }),
        )
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
