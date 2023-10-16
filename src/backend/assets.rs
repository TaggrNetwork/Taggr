use crate::{config::CONFIG, metadata::set_index_metadata};
use base64::{engine::general_purpose, Engine as _};
use ic_certified_map::{labeled, labeled_hash, AsHashTree, Hash, RbTree};
use serde_bytes::ByteBuf;
use sha2::{Digest, Sha256};
use std::collections::HashMap;

pub type Headers = Vec<(String, String)>;

const LABEL: &[u8] = b"http_assets";
static mut ASSET_HASHES: Option<RbTree<Vec<u8>, Hash>> = None;
static mut ASSETS: Option<HashMap<String, (Headers, Vec<u8>)>> = None;

fn asset_hashes<'a>() -> &'a mut RbTree<Vec<u8>, Hash> {
    unsafe { ASSET_HASHES.as_mut().expect("uninitialized") }
}

fn assets<'a>() -> &'a mut HashMap<String, (Headers, Vec<u8>)> {
    unsafe { ASSETS.as_mut().expect("uninitialized") }
}

pub static INDEX_HTML: &[u8] = include_bytes!("../../dist/frontend/index.html");
pub fn index_html_headers() -> Headers {
    vec![(
        "Content-Type".to_string(),
        "text/html; charset=UTF-8".to_string(),
    )]
}

pub fn load() {
    unsafe {
        ASSET_HASHES = Some(Default::default());
        ASSETS = Some(Default::default());
    }

    add_asset(
        &["/", "/index.html"],
        index_html_headers(),
        set_index_metadata(INDEX_HTML),
    );

    add_asset(
        &["/index.js"],
        vec![
            ("Content-Type".to_string(), "text/javascript".to_string()),
            ("Content-Encoding".to_string(), "gzip".to_string()),
        ],
        include_bytes!("../../dist/frontend/index.js.gz").to_vec(),
    );

    add_asset(
        &["/favicon.ico"],
        vec![
            (
                "Content-Type".to_string(),
                "image/vnd.microsoft.icon".to_string(),
            ),
            ("Cache-Control".to_string(), "public".to_string()),
        ],
        include_bytes!("../../dist/frontend/favicon.ico").to_vec(),
    );

    add_asset(
        &["/_/raw/apple-touch-icon.png"],
        vec![
            ("Content-Type".to_string(), "image/png".to_string()),
            ("Cache-Control".to_string(), "public".to_string()),
        ],
        include_bytes!("../../dist/frontend/apple-touch-icon.png").to_vec(),
    );

    add_asset(
        &["/_/raw/social-image.jpg"],
        vec![
            ("Content-Type".to_string(), "image/jpeg".to_string()),
            ("Cache-Control".to_string(), "public".to_string()),
        ],
        include_bytes!("../../dist/frontend/social-image.jpg").to_vec(),
    );

    let mut domains = Vec::from(CONFIG.domains);
    let can_domain = format!("{}.ic0.app", super::id());
    domains.push(&can_domain);
    add_asset(
        &["/.well-known/ii-alternative-origins"],
        vec![
            ("Content-Type".to_string(), "application/json".to_string()),
            ("Cache-Control".to_string(), "public".to_string()),
        ],
        format!(
            "{{\"alternativeOrigins\": [ {} ]}}",
            domains
                .iter()
                .chain(std::iter::once(&CONFIG.staging))
                .map(|domain| format!("\"https://{}\"", &domain))
                .collect::<Vec<_>>()
                .join(",")
        )
        .as_bytes()
        .to_vec(),
    );

    add_asset(
        &["/.well-known/ic-domains"],
        Default::default(),
        domains.join("\n").as_bytes().to_vec(),
    );

    set_certified_data(&labeled_hash(LABEL, &asset_hashes().root_hash()));
}

#[allow(unused_variables)]
pub fn set_certified_data(data: &[u8]) {
    #[cfg(test)]
    return;
    #[cfg(not(test))]
    ic_cdk::api::set_certified_data(&labeled_hash(LABEL, &asset_hashes().root_hash()));
}

fn add_asset(paths: &[&str], headers: Headers, bytes: Vec<u8>) {
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let hash = hasher.finalize().into();
    for path in paths {
        asset_hashes().insert(path.as_bytes().to_vec(), hash);
        assets().insert(path.to_string(), (headers.clone(), bytes.clone()));
    }
}

pub fn asset_certified(path: &str) -> Option<(Headers, ByteBuf)> {
    let (mut headers, bytes) = asset(path)?;
    headers.push(certificate_header(path));
    Some((headers, bytes))
}

pub fn asset(path: &str) -> Option<(Headers, ByteBuf)> {
    let (headers, bytes) = assets().get(path)?;
    Some((headers.clone(), ByteBuf::from(bytes.as_slice())))
}

fn certificate_header(path: &str) -> (String, String) {
    let certificate = ic_cdk::api::data_certificate().expect("no certificate");
    let witness = asset_hashes().witness(path.as_bytes());
    let tree = labeled(LABEL, witness);
    let mut serializer = serde_cbor::ser::Serializer::new(Vec::new());
    serializer.self_describe().expect("tagging failed");
    use serde::Serialize;
    tree.serialize(&mut serializer).expect("couldn't serialize");
    (
        "IC-Certificate".to_string(),
        format!(
            "certificate=:{}:, tree=:{}:",
            general_purpose::STANDARD.encode(certificate),
            general_purpose::STANDARD.encode(serializer.into_inner())
        ),
    )
}
