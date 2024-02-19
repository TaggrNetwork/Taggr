use super::assets;
use crate::assets::{index_html_headers, INDEX_HTML};
use crate::post::Post;
use crate::read;
use crate::{config::CONFIG, metadata::set_metadata};
use candid::CandidType;
use serde::{Deserialize, Serialize};
use serde_bytes::ByteBuf;

pub type Headers = Vec<(String, String)>;

#[derive(Clone, CandidType, Deserialize)]
pub struct HttpRequest {
    url: String,
    headers: Headers,
}

impl HttpRequest {
    pub fn path(&self) -> &str {
        match self.url.find('?') {
            None => &self.url[..],
            Some(index) => &self.url[..index],
        }
    }

    /// Searches for the first appearance of a parameter in the request URL.
    /// Returns `None` if the given parameter does not appear in the query.
    pub fn raw_query_param(&self, param: &str) -> Option<&str> {
        const QUERY_SEPARATOR: &str = "?";
        let query_string = self.url.split(QUERY_SEPARATOR).nth(1)?;
        if query_string.is_empty() {
            return None;
        }
        const PARAMETER_SEPARATOR: &str = "&";
        for chunk in query_string.split(PARAMETER_SEPARATOR) {
            const KEY_VALUE_SEPARATOR: &str = "=";
            let mut split = chunk.splitn(2, KEY_VALUE_SEPARATOR);
            let name = split.next()?;
            if name == param {
                return Some(split.next().unwrap_or_default());
            }
        }
        None
    }
}

#[derive(Debug, CandidType, Serialize)]
pub struct HttpResponse {
    status_code: u16,
    headers: Headers,
    body: ByteBuf,
    upgrade: Option<bool>,
}

#[ic_cdk_macros::update]
fn http_request_update(req: HttpRequest) -> HttpResponse {
    let path = &req.url;
    route(path)
        .map(|(headers, body)| HttpResponse {
            status_code: 200,
            headers,
            body,
            upgrade: None,
        })
        .unwrap_or_else(|| panic!("no assets for {}", path))
}

#[ic_cdk_macros::query]
fn http_request(req: HttpRequest) -> HttpResponse {
    let path = &req.url;

    use serde_json;
    use std::str::FromStr;

    if req.path() == "/api/v1/proposals" {
        read(|state| {
            let offset = usize::from_str(req.raw_query_param("offset").unwrap_or_default())
                .unwrap_or_default()
                .min(state.proposals.len());
            let limit = usize::from_str(req.raw_query_param("limit").unwrap_or_default())
                .unwrap_or(1_000_usize);
            let end = (offset + limit).min(state.proposals.len());

            let proposal_slice = if let Some(slice) = state.proposals.get(offset..end) {
                slice
            } else {
                &[]
            };
            HttpResponse {
                status_code: 200,
                headers: vec![(
                    "Content-Type".to_string(),
                    "application/json; charset=UTF-8".to_string(),
                )],
                body: ByteBuf::from(serde_json::to_vec(&proposal_slice).unwrap_or_default()),
                upgrade: None,
            }
        })
    }
    // If the asset is certified, return it, otherwise, upgrade to http_request_update
    else if let Some((headers, body)) = assets::asset_certified(path) {
        HttpResponse {
            status_code: 200,
            headers,
            body,
            upgrade: None,
        }
    } else {
        HttpResponse {
            status_code: 200,
            headers: Default::default(),
            body: Default::default(),
            upgrade: Some(true),
        }
    }
}

fn route(path: &str) -> Option<(Headers, ByteBuf)> {
    read(|state| {
        let domain = CONFIG.domains.first().cloned().expect("no domains");
        let filter = |val: &str| {
            val.chars()
                .filter(|c| c.is_alphanumeric() || " .,?!-:/@\n#".chars().any(|v| &v == c))
                .collect::<String>()
        };
        let mut parts = path.split('/').skip(1);
        match (parts.next(), parts.next()) {
            (Some("post"), Some(id)) | (Some("thread"), Some(id)) => {
                if let Some(post) =
                    Post::get(state, &id.parse::<u64>().expect("couldn't parse post id"))
                {
                    return index(
                        domain,
                        &format!(
                            "{}/{}",
                            match post.parent {
                                None => "post",
                                _ => "thread",
                            },
                            post.id
                        ),
                        &format!(
                            "{} #{} by @{}",
                            match post.parent {
                                None => "Post",
                                _ => "Reply",
                            },
                            post.id,
                            state.users.get(&post.user)?.name
                        ),
                        &filter(&post.body),
                        "article",
                    );
                }
                None
            }
            (Some("journal"), Some(handle)) => {
                let user = state.user(handle)?;
                index(
                    domain,
                    &format!("journal/{}", user.name),
                    &format!("@{}'s journal", user.name),
                    &filter(&user.about),
                    "website",
                )
            }
            (Some("user"), Some(handle)) => {
                let user = state.user(handle)?;
                index(
                    domain,
                    &format!("user/{}", user.name),
                    &format!("User @{}", user.name),
                    &filter(&user.about),
                    "profile",
                )
            }
            (Some("realm"), Some(arg)) => {
                let id = arg.to_uppercase();
                let realm = state.realms.get(&id)?;
                index(
                    domain,
                    &format!("realm/{}", id),
                    &format!("Realm {}", id),
                    &filter(&realm.description),
                    "website",
                )
            }
            (Some("feed"), Some(filter)) => index(
                domain,
                &format!("feed/{}", filter),
                filter,
                &format!("Latest posts on {}", filter),
                "website",
            ),
            _ => assets::asset("/"),
        }
    })
}

fn index(
    host: &str,
    path: &str,
    title: &str,
    desc: &str,
    page_type: &str,
) -> Option<(Headers, ByteBuf)> {
    Some((
        index_html_headers(),
        ByteBuf::from(set_metadata(INDEX_HTML, host, path, title, desc, page_type)),
    ))
}

#[test]
fn should_return_proposals() {
    use crate::proposals::{Proposal, Status};
    use crate::State;

    let mut http_request_arg = HttpRequest {
        url: "/api/v1/proposals".to_string(),
        headers: vec![],
    };
    let mut state = State::default();

    for id in 0..10_u32 {
        state.proposals.push(Proposal {
            id,
            proposer: 0,
            bulletins: vec![(0, true, 1)],
            status: Status::Open,
            ..Default::default()
        });
    }
    crate::mutate(|s| *s = state);

    fn check_proposals(http_request_arg: HttpRequest, len: usize, start: u32, end: u32) {
        let http_resp = http_request(http_request_arg.clone());
        match serde_json::from_slice::<Vec<Proposal>>(&http_resp.body) {
            Ok(proposals) => {
                assert_eq!(proposals.len(), len);
                assert_eq!(proposals[0].id, start);
                assert_eq!(proposals.last().unwrap().id, end);
            }
            Err(_) => panic!("failed to deserialize json"),
        }
    }

    check_proposals(http_request_arg.clone(), 10_usize, 0_u32, 9_u32);

    http_request_arg.url = "/api/v1/proposals?limit=5".to_string();
    check_proposals(http_request_arg.clone(), 5_usize, 0_u32, 4_u32);

    http_request_arg.url = "/api/v1/proposals?limit=3&offset=6".to_string();
    check_proposals(http_request_arg.clone(), 3_usize, 6_u32, 8_u32);

    http_request_arg.url = "/api/v1/proposals?offset=6&limit=3".to_string();
    check_proposals(http_request_arg.clone(), 3_usize, 6_u32, 8_u32);
}
