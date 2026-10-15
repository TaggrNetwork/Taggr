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

// Upper bound on posts scanned by the wildcard search to keep the query within
// the instruction limit on large state (a no-match query would otherwise scan
// every post).
const MAX_POSTS_SCANNED: usize = 100_000;

pub fn search(domain: String, state: &State, mut query: String) -> Vec<SearchResult> {
    query = query.to_lowercase();
    let mut terms = query
        .split(' ')
        .filter(|word| word.len() > 1)
        .collect::<Vec<_>>();

    // Order tokens by kind (realm `/`, then user `@`, then plain word) so the
    // match arms below see a canonical order regardless of how the user typed
    // them. A stable sort keeps relative order within a kind. Don't sort
    // lexicographically: digit-leading words (ASCII 48-57) would sort between
    // `/` (47) and `@` (64) and break the arms.
    terms.sort_by_key(|term| match term.chars().next() {
        Some('/') => 0,
        Some('@') => 1,
        _ => 2,
    });
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
                .filter(|post| !post.is_deleted())
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
                        if body.to_lowercase().contains(word) {
                            return Some(SearchResult {
                                id: *id,
                                user_id: *user,
                                relevant: snippet(body, word),
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
                .filter(|post| !post.is_deleted())
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
                            relevant: snippet(body, ""),
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
                .filter(|post| !post.is_deleted())
                .filter_map(|Post { id, body, user, .. }| {
                    if body.to_lowercase().contains(word) {
                        return Some(SearchResult {
                            id: *id,
                            user_id: *user,
                            relevant: snippet(body, word),
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
                    if body.to_lowercase().contains(word) {
                        return Some(SearchResult {
                            id: *id,
                            user_id: *user,
                            relevant: snippet(body, word),
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
                .take(MAX_RESULTS)
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
                    relevant: snippet(realm.description.as_str(), ""),
                    result: "realm".to_string(),
                    ..Default::default()
                })
                .take(MAX_RESULTS)
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
            if realm.description.to_lowercase().contains(term) {
                return Some(SearchResult {
                    generic_id: id.clone(),
                    relevant: snippet(realm.description.as_str(), term),
                    result: "realm".to_string(),
                    ..Default::default()
                });
            }
            None
        })
        .chain(
            state
                .last_posts(domain, None, 0, 0, true)
                .take(MAX_POSTS_SCANNED)
                .filter_map(|Post { id, body, user, .. }| {
                    if id.to_string() == term {
                        return Some(SearchResult {
                            id: *id,
                            user_id: *user,
                            relevant: snippet(body, ""),
                            result: "post".to_string(),
                            ..Default::default()
                        });
                    }
                    if body.to_lowercase().contains(term) {
                        return Some(SearchResult {
                            id: *id,
                            user_id: *user,
                            relevant: snippet(body, term),
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

// Returns a ~SNIPPET_LEN window of `value` (markdown stripped) centred on the
// first occurrence of `term`. `term` must be lowercase; pass "" to anchor at the
// start. The term is located inside the stripped text so the offset stays valid
// (the caller's match index would be off after markdown removal and is a byte,
// not a char, index).
fn snippet(value: &str, term: &str) -> String {
    let value = remove_markdown(value);
    if value.len() < SNIPPET_LEN {
        value
    } else {
        let char_offset = if term.is_empty() {
            0
        } else {
            let lower = value.to_lowercase();
            lower
                .find(term)
                // Count chars of the lowercased prefix to get a char offset for
                // `value.chars()` below (slicing `lower` by its own byte index is
                // always on a char boundary, so this never panics).
                .map(|byte_idx| lower[..byte_idx].chars().count())
                .unwrap_or(0)
        };
        value
            .chars()
            .skip(char_offset.saturating_sub(SNIPPET_LEN / 2))
            .skip_while(|c| c.is_alphanumeric())
            .take(SNIPPET_LEN)
            .collect::<String>()
    }
    .replace('\n', " ")
}

// Drops markdown syntax for search snippets. Link text is kept; image alt text,
// link/image destinations and reference labels are dropped. Markers glued to
// text (e.g. `snake_case`, `C#`, a lone backtick) are kept.
fn remove_markdown(md: &str) -> String {
    let chars: Vec<char> = md.chars().collect();
    let n = chars.len();
    let mut result = String::new();
    let mut i = 0;

    while i < n {
        match chars[i] {
            // Emphasis and code-span markers are only dropped at word
            // boundaries, so literal text like `snake_case` survives.
            '`' | '*' | '_' if !intraword(&chars, i) => i += 1,
            // Heading markers carry no meaning for a snippet; keep `#` glued to
            // text, like `C#` or `#42`.
            '#' if !adjacent_alnum(&chars, i) => i += 1,
            // Image: drop `![alt]` and the following destination or label.
            '!' if i + 1 < n && chars[i + 1] == '[' => {
                let mut j = i + 2;
                while j < n && chars[j] != ']' {
                    j += 1;
                }
                if j < n {
                    i = skip_dest(&chars, j + 1);
                } else {
                    // Unterminated `![`: keep the `!` as literal text.
                    result.push('!');
                    i += 1;
                }
            }
            // Link: keep the text, drop `](dest)` or `][label]`.
            ']' => i = skip_dest(&chars, i + 1),
            '[' => i += 1,
            _ => {
                result.push(chars[i]);
                i += 1;
            }
        }
    }

    result
}

// True when both neighbours of `chars[i]` are alphanumeric, i.e. the marker sits
// inside a word.
fn intraword(chars: &[char], i: usize) -> bool {
    i > 0 && chars[i - 1].is_alphanumeric() && i + 1 < chars.len() && chars[i + 1].is_alphanumeric()
}

// True when either neighbour of `chars[i]` is alphanumeric.
fn adjacent_alnum(chars: &[char], i: usize) -> bool {
    (i > 0 && chars[i - 1].is_alphanumeric())
        || (i + 1 < chars.len() && chars[i + 1].is_alphanumeric())
}

// If `i` points at a link/image destination `(...)` or a reference label
// `[...]`, returns the index just past the matching closer. Otherwise, or when
// the closer is missing, returns `i` unchanged.
fn skip_dest(chars: &[char], i: usize) -> usize {
    let close = match chars.get(i) {
        Some('(') => ')',
        Some('[') => ']',
        _ => return i,
    };
    let open = chars[i];
    let mut depth = 0usize;
    let mut j = i;
    while j < chars.len() {
        if chars[j] == open {
            depth += 1;
        } else if chars[j] == close {
            depth -= 1;
            if depth == 0 {
                return j + 1;
            }
        }
        j += 1;
    }
    i
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

#[cfg(test)]
mod tests {
    use super::remove_markdown;

    #[test]
    fn keeps_link_text_after_exclamation() {
        assert_eq!(
            remove_markdown("Wow! see [the docs](http://example.com)"),
            "Wow! see the docs"
        );
    }

    #[test]
    fn drops_image_but_keeps_surrounding_text() {
        assert_eq!(
            remove_markdown("before ![alt](img.png) after"),
            "before  after"
        );
    }

    #[test]
    fn keeps_literal_emphasis_markers_inside_words() {
        assert_eq!(remove_markdown("snake_case and a*b"), "snake_case and a*b");
    }

    #[test]
    fn strips_emphasis_markers() {
        assert_eq!(remove_markdown("*bold* and _italic_"), "bold and italic");
    }

    #[test]
    fn keeps_parentheses_in_plain_text() {
        assert_eq!(
            remove_markdown("see (this) [x](http://a(b))"),
            "see (this) x"
        );
    }

    #[test]
    fn drops_reference_link_label() {
        assert_eq!(remove_markdown("see [the docs][ref]"), "see the docs");
        assert_eq!(remove_markdown("see [the docs][]"), "see the docs");
    }

    #[test]
    fn drops_reference_image() {
        assert_eq!(remove_markdown("a ![alt][ref] b"), "a  b");
    }

    #[test]
    fn keeps_hash_glued_to_text() {
        assert_eq!(remove_markdown("C# and #42 stay"), "C# and #42 stay");
    }

    #[test]
    fn strips_heading_markers() {
        assert_eq!(remove_markdown("## Title"), " Title");
        assert_eq!(remove_markdown("#hashtag"), "#hashtag");
    }

    #[test]
    fn keeps_literal_backticks_inside_words() {
        assert_eq!(remove_markdown("don`t"), "don`t");
        assert_eq!(remove_markdown("a `code` b"), "a code b");
    }

    #[test]
    fn keeps_bang_when_unterminated_image() {
        assert_eq!(remove_markdown("look![oops"), "look!oops");
    }
}
