use super::{assets, state};
use crate::config::CONFIG;
use crate::post::Post;
use ic_cdk::export::candid::CandidType;
use serde::{Deserialize, Serialize};
use serde_bytes::ByteBuf;

pub type Headers = Vec<(String, String)>;

#[derive(CandidType, Deserialize)]
pub struct HttpRequest {
    url: String,
    headers: Headers,
}

#[derive(CandidType, Serialize)]
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
            headers: Default::default(),
            body: Default::default(),
            upgrade: Some(true),
        }
    }
}

fn route(path: &str) -> Option<(Headers, ByteBuf)> {
    let state = state();
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
            )
        }
        (Some("user"), Some(handle)) => {
            let user = state.user(handle)?;
            index(
                domain,
                &format!("user/{}", user.name),
                &format!("User @{}", user.name),
                &filter(&user.about),
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
            )
        }
        (Some("feed"), Some(filter)) => index(
            domain,
            &format!("feed/{}", filter),
            filter,
            &format!("Latest posts on {}", filter),
        ),
        _ => index(domain, "", CONFIG.name, "Web3 Social Network"),
    }
}

fn index(host: &str, path: &str, title: &str, desc: &str) -> Option<(Headers, ByteBuf)> {
    assets::asset("/").map(|(headers, body)| {
        (
            headers,
            ByteBuf::from(
                String::from_utf8_lossy(&body)
                    .replace(
                        r#"<meta name="mark" content="OG">"#,
                        &format!(
                            r#"<meta content="https://{}/#/{}" property="og:url" />
                               <meta content="{}" property="og:title" />
                               <meta content="{}" property="og:description" />"#,
                            host, path, title, &desc
                        ),
                    )
                    .as_bytes()
                    .to_vec(),
            ),
        )
    })
}
