use super::assets;
use crate::assets::{index_html_headers, INDEX_HTML};
use crate::post::Post;
use crate::user::{Pfp, UserId};
use crate::{config::CONFIG, metadata::set_metadata};
use crate::{pfp, read};
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

#[derive(Debug, Default, CandidType, Serialize)]
pub struct HttpResponse {
    status_code: u16,
    headers: Headers,
    body: ByteBuf,
    upgrade: Option<bool>,
}

#[ic_cdk_macros::update]
fn http_request_update(req: HttpRequest) -> HttpResponse {
    let url = &req.url;
    route(url)
        .map(|(headers, body)| HttpResponse {
            status_code: 200,
            headers,
            body,
            upgrade: None,
        })
        .unwrap_or_else(|| HttpResponse {
            status_code: 400,
            ..Default::default()
        })
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq)]
struct Metadata<'a> {
    decimals: u8,
    symbol: &'a str,
    token_name: &'a str,
    fee: u64,
    logo: &'a str,
    maximum_supply: u64,
    total_supply: u64,
    latest_proposal_id: Option<u32>,
    proposal_count: u64,
}

#[ic_cdk_macros::query]
fn http_request(req: HttpRequest) -> HttpResponse {
    let path = &req.url;

    use serde_json;
    use std::str::FromStr;

    let mut parts = req.path().split('/').filter(|part| !part.is_empty());

    match (parts.next(), parts.next(), parts.next()) {
        (Some("pfp"), Some(user_id_str), None) => {
            let user_id = user_id_str.parse::<UserId>().unwrap_or_default();
            serve_pfp(user_id, 4)
        }
        (Some("pfp_preview"), Some(user_id_str), Some(params)) => {
            let user_id = user_id_str.parse::<UserId>().unwrap_or_default();
            let mut params = params.split('-');
            let parse = |s: Option<&str>| s.unwrap_or_default().parse::<u64>().unwrap_or_default();
            let colors = parse(params.next());
            let nonce = parse(params.next());
            let palette_nonce = parse(params.next());
            serve_pfp_preview(user_id, colors, nonce, palette_nonce, 1, 16)
        }
        (Some("api"), Some("v1"), Some("proposals")) => read(|state| {
            let offset = usize::from_str(req.raw_query_param("offset").unwrap_or_default())
                .unwrap_or_default()
                .min(state.proposals.len());
            let limit = usize::from_str(req.raw_query_param("limit").unwrap_or_default())
                .unwrap_or(1_000_usize);
            let end = (offset + limit).min(state.proposals.len());

            let proposal_slice = state.proposals.get(offset..end).unwrap_or_default();
            HttpResponse {
                status_code: 200,
                headers: vec![(
                    "Content-Type".to_string(),
                    "application/json; charset=UTF-8".to_string(),
                )],
                body: ByteBuf::from(serde_json::to_vec(&proposal_slice).unwrap_or_default()),
                upgrade: None,
            }
        }),
        (Some("api"), Some("v1"), Some("metadata")) => {
            use base64::{engine::general_purpose, Engine as _};
            read(|s| HttpResponse {
                status_code: 200,
                headers: vec![(
                    "Content-Type".to_string(),
                    "application/json; charset=UTF-8".to_string(),
                )],
                body: ByteBuf::from(
                    serde_json::to_vec(&Metadata {
                        decimals: CONFIG.token_decimals,
                        symbol: CONFIG.token_symbol,
                        token_name: CONFIG.name,
                        fee: CONFIG.transaction_fee,
                        logo: &format!(
                            "data:image/png;base64,{}",
                            general_purpose::STANDARD
                                .encode(include_bytes!("../frontend/assets/apple-touch-icon.png"))
                        ),
                        maximum_supply: CONFIG.maximum_supply,
                        total_supply: s.balances.values().copied().sum::<u64>(),
                        latest_proposal_id: s.proposals.last().map(|p| p.id),
                        proposal_count: s.proposals.len() as u64,
                    })
                    .unwrap_or_default(),
                ),
                upgrade: None,
            })
        }
        _ => {
            // If the asset is certified, return it, otherwise, upgrade to http_request_update
            if let Some((headers, body)) = assets::asset_certified(path) {
                HttpResponse {
                    status_code: 200,
                    headers,
                    body,
                    upgrade: None,
                }
            } else {
                HttpResponse {
                    status_code: 200,
                    upgrade: Some(true),
                    ..Default::default()
                }
            }
        }
    }
}

fn route(url: &str) -> Option<(Headers, ByteBuf)> {
    read(|state| {
        let filter = |val: &str| {
            val.chars()
                .filter(|c| c.is_alphanumeric() || " .,?!-:/@\n#".chars().any(|v| &v == c))
                .collect::<String>()
        };
        let mut parts = url.split('/');
        let domain = parts.next()?;
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

fn serve_pfp(user_id: UserId, scale: u32) -> HttpResponse {
    read(|state| {
        let user = state.users.get(&user_id).expect("no user found");
        let Pfp {
            colors,
            nonce,
            palette_nonce,
            ..
        } = user.pfp;
        let caching_age_secs = 604800; // one week
        serve_pfp_preview(
            user.id,
            colors,
            nonce,
            palette_nonce,
            caching_age_secs,
            scale,
        )
    })
}

fn serve_pfp_preview(
    user_id: UserId,
    colors: u64,
    nonce: u64,
    palette_nonce: u64,
    age_secs: u64,
    scale: u32,
) -> HttpResponse {
    let bytes = pfp::pfp(user_id, nonce, palette_nonce, colors, scale);
    let age = format!("public, max-age={}", age_secs);
    let headers = &[
        ("Content-Type", "image/png"),
        // Cache for a week.
        ("Cache-Control", age.as_str()),
    ];
    HttpResponse {
        status_code: 200,
        headers: headers
            .iter()
            .map(|(key, value)| (key.to_string(), value.to_string()))
            .collect(),
        body: ByteBuf::from(bytes.as_slice()),
        upgrade: None,
    }
}

#[cfg(test)]
mod test {

    use super::*;

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

    #[test]
    fn should_return_metadata() {
        use crate::proposals::{Proposal, Status};
        use crate::State;

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

        let http_resp = http_request(HttpRequest {
            url: "/api/v1/metadata".to_string(),
            headers: vec![],
        });
        match serde_json::from_slice::<Metadata>(&http_resp.body) {
            Ok(metadata) => {
                assert_eq!(metadata, Metadata {
                decimals: 2,
                symbol: "TAGGR",
                token_name: "Taggr",
                fee: 10,
                logo: "data:image/png;base64,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",
                maximum_supply: 100000000,
                total_supply: 0,
                latest_proposal_id: Some(
                    9,
                ),
                proposal_count: 10,
            });
            }
            Err(_) => panic!("failed to deserialize json"),
        }
    }
}
