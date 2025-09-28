use crate::{
    config::CONFIG,
    env::{domains::DomainConfig, token},
    id,
    metadata::set_index_metadata,
};
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
    #[allow(static_mut_refs)]
    unsafe {
        ASSET_HASHES.as_mut().expect("uninitialized")
    }
}

fn assets<'a>() -> &'a mut HashMap<String, (Headers, Vec<u8>)> {
    #[allow(static_mut_refs)]
    unsafe {
        ASSETS.as_mut().expect("uninitialized")
    }
}

pub static INDEX_HTML: &[u8] = include_bytes!("../../dist/frontend/index.html");
pub fn index_html_headers() -> Headers {
    vec![("Content-Type".into(), "text/html; charset=UTF-8".into())]
}

pub fn load(domains: &HashMap<String, DomainConfig>) {
    unsafe {
        ASSET_HASHES = Some(Default::default());
        ASSETS = Some(Default::default());
    }

    let dao_owned_domain = domains
        .iter()
        .find(|(_, cfg)| cfg.owner.is_none())
        .map(|(domain, _)| domain)
        .expect("no DAO domains");

    add_asset(
        &["/", "/index.html"],
        index_html_headers(),
        set_index_metadata(dao_owned_domain, INDEX_HTML),
    );

    add_asset(
        &["/index.js"],
        vec![
            ("Content-Type".into(), "text/javascript".into()),
            ("Content-Encoding".into(), "gzip".into()),
        ],
        include_bytes!("../../dist/frontend/index.js.gz").to_vec(),
    );

    add_asset(
        &["/dfinity.js"],
        vec![
            ("Content-Type".into(), "text/javascript".into()),
            ("Content-Encoding".into(), "gzip".into()),
        ],
        include_bytes!("../../dist/frontend/dfinity.js.gz").to_vec(),
    );

    add_asset(
        &["/react.js"],
        vec![
            ("Content-Type".into(), "text/javascript".into()),
            ("Content-Encoding".into(), "gzip".into()),
        ],
        include_bytes!("../../dist/frontend/react.js.gz").to_vec(),
    );

    add_asset(
        &["/vendors.js"],
        vec![
            ("Content-Type".into(), "text/javascript".into()),
            ("Content-Encoding".into(), "gzip".into()),
        ],
        include_bytes!("../../dist/frontend/vendors.js.gz").to_vec(),
    );

    add_asset(
        &["/app-components.js"],
        vec![
            ("Content-Type".into(), "text/javascript".into()),
            ("Content-Encoding".into(), "gzip".into()),
        ],
        include_bytes!("../../dist/frontend/app-components.js.gz").to_vec(),
    );

    add_asset(
        &["/favicon.ico"],
        vec![("Content-Type".into(), "image/vnd.microsoft.icon".into())],
        include_bytes!("../../src/frontend/assets/favicon.ico").to_vec(),
    );

    add_asset(
        &["/_/raw/apple-touch-icon.png"],
        vec![("Content-Type".into(), "image/png".into())],
        include_bytes!("../../src/frontend/assets/apple-touch-icon.png").to_vec(),
    );

    add_asset(
        &["/_/raw/social-image.jpg"],
        vec![("Content-Type".into(), "image/jpeg".into())],
        include_bytes!("../../src/frontend/assets/social-image.jpg").to_vec(),
    );

    add_asset(
        &["/font-regular.woff2"],
        vec![("Content-Type".into(), "application/font-woff2".into())],
        include_bytes!("../../src/frontend/assets/font-regular.woff2").to_vec(),
    );

    add_asset(
        &["/font-bold.woff2"],
        vec![("Content-Type".into(), "application/font-woff2".into())],
        include_bytes!("../../src/frontend/assets/font-bold.woff2").to_vec(),
    );

    add_asset(
        &["/WHITEPAPER.md"],
        vec![("Content-Type".into(), "text/markdown".into())],
        include_bytes!("../../src/frontend/assets/WHITEPAPER.md").to_vec(),
    );

    add_asset(
        &["/.well-known/ii-alternative-origins"],
        vec![("Content-Type".into(), "application/json".into())],
        format!(
            "{{\"alternativeOrigins\": [ {} ]}}",
            ["ic0.app", "icp0.io"]
                .map(|domain| format!("\"https://{}.{domain}\"", id()))
                .join(",")
        )
        .as_bytes()
        .to_vec(),
    );

    add_domains(domains);

    certify();
}

pub fn add_domains(domains: &HashMap<String, DomainConfig>) {
    add_asset(
        &["/.well-known/ic-domains"],
        Default::default(),
        domains
            .keys()
            .cloned()
            .collect::<Vec<_>>()
            .join("\n")
            .as_bytes()
            .to_vec(),
    );
}

pub fn root_hash() -> [u8; 32] {
    asset_hashes().root_hash()
}

#[allow(unused_variables)]
pub fn certify() {
    let value = &labeled_hash(LABEL, &asset_hashes().root_hash());
    #[cfg(test)]
    return;
    #[cfg(not(test))]
    ic_cdk::api::set_certified_data(value)
}

pub fn add_value_to_certify(label: &str, hash: [u8; 32]) {
    asset_hashes().insert(label.as_bytes().to_vec(), hash);
}

fn add_asset(paths: &[&str], headers: Headers, bytes: Vec<u8>) {
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let hash = hasher.finalize().into();
    for path in paths {
        add_value_to_certify(path, hash);
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

pub fn export_token_supply(total_supply: u128) {
    for (path, tokens) in &[
        ("total_supply", total_supply),
        ("maximum_supply", CONFIG.maximum_supply as u128),
    ] {
        add_asset(
            &[format!("/api/v1/{}", path).as_str()],
            vec![("Content-Type".into(), "application/json".into())],
            format!("{}", *tokens as f64 / token::base() as f64)
                .as_bytes()
                .to_vec(),
        )
    }
    certify();
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
        "IC-Certificate".into(),
        format!(
            "certificate=:{}:, tree=:{}:",
            general_purpose::STANDARD.encode(certificate),
            general_purpose::STANDARD.encode(serializer.into_inner())
        ),
    )
}
