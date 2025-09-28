use std::path::Path;

use candid::{decode_one, encode_args, encode_one, Principal};
use ic_cdk::api::management_canister::main::CanisterId;
use pocket_ic::{PocketIc, RejectCode};

use crate::{controller, get_wasm, setup, setup_from_snapshot};

fn create_test_user(
    pic: &PocketIc,
    backend: CanisterId,
    caller: Principal,
    name: &str,
) -> Option<u64> {
    let result = pic.update_call(
        backend,
        caller,
        "create_test_user",
        encode_one(name).unwrap(),
    );

    match result {
        Ok(blob) => Some(decode_one(&blob).unwrap()),
        Err(err) => {
            if err.reject_code == RejectCode::DestinationInvalid {
                return None;
            }
            unreachable!("{}", err);
        }
    }
}

fn add_post(
    pic: &PocketIc,
    backend: CanisterId,
    caller: Principal,
    body: &str,
    blobs: Vec<(String, Vec<u8>)>,
    parent: Option<u64>,
) -> Result<u64, String> {
    let realm: Option<u64> = None;
    let extension: Option<Vec<u8>> = None;

    let result = pic.update_call(
        backend,
        caller,
        "add_post",
        encode_args((body, blobs, parent, realm, extension)).unwrap(),
    );

    let maybe_post_id: Result<u64, String> = match result {
        Ok(blob) => decode_one(&blob).unwrap(),
        Err(err) => unreachable!("{}", err),
    };

    maybe_post_id
}

fn posts(
    pic: &PocketIc,
    backend: CanisterId,
    caller: Principal,
    post_ids: Vec<u64>,
) -> Vec<serde_json::Value> {
    let result = pic.query_call(
        backend,
        caller,
        "posts",
        serde_json::json!(post_ids).to_string().as_bytes().to_vec(),
    );

    let json: String = match result {
        Ok(blob) => String::from_utf8(blob).unwrap(),
        Err(err) => unreachable!("{}", err),
    };

    let posts: serde_json::Value = serde_json::from_str(&json).unwrap();
    let posts = posts.as_array().unwrap();
    posts.clone()
}

fn users(pic: &PocketIc, backend: CanisterId, caller: Principal) -> Vec<serde_json::Value> {
    let result = pic.query_call(backend, caller, "users", vec![]);

    let json: String = match result {
        Ok(blob) => String::from_utf8(blob).unwrap(),
        Err(err) => unreachable!("{}", err),
    };

    let users: serde_json::Value = serde_json::from_str(&json).unwrap();
    let users = users.as_array().unwrap();
    users.clone()
}

fn journal(
    pic: &PocketIc,
    backend: CanisterId,
    caller: Principal,
    user: &str,
) -> Vec<serde_json::Value> {
    let result = pic.query_call(
        backend,
        caller,
        "journal",
        serde_json::json!([user, 0, 0])
            .to_string()
            .as_bytes()
            .to_vec(),
    );

    let json: String = match result {
        Ok(blob) => String::from_utf8(blob).unwrap(),
        Err(err) => unreachable!("{}", err),
    };

    let posts: serde_json::Value = serde_json::from_str(&json).unwrap();
    let posts = posts.as_array().unwrap();
    posts.clone()
}

#[test]
fn test_add_post() {
    let (pic, backend) = setup("taggr");

    let user_id = create_test_user(&pic, backend, controller(), "test");
    if user_id.is_none() {
        eprintln!(
            "Skipping test_add_post because Wasm binary doesn't have create_test_user method"
        );
        return;
    }
    let post_id = add_post(&pic, backend, controller(), "lorem ipsum", vec![], None).unwrap();
    let post = &posts(&pic, backend, controller(), vec![post_id])[0];

    let post: &serde_json::Value = if post.is_array() { &post[0] } else { post };

    assert_eq!(post.get("id").unwrap().as_u64().unwrap(), post_id);
    assert_eq!(post.get("body").unwrap().as_str().unwrap(), "lorem ipsum");
}

#[test]
fn test_upgrades() {
    let (pic, backend) = setup("taggr");

    let user_id = create_test_user(&pic, backend, controller(), "test");
    if user_id.is_none() {
        eprintln!(
            "Skipping test_upgrades because Wasm binary doesn't have create_test_user method"
        );
        return;
    }

    let mut post_ids = vec![];
    let mut bodies = vec![];
    for i in 0..100 {
        let body = format!("lorem ipsum {}", i);
        let post_id = add_post(&pic, backend, controller(), &body, vec![], None).unwrap();
        post_ids.push(post_id);
        bodies.push(body);
    }

    pic.upgrade_canister(
        backend,
        get_wasm("taggr"),
        controller().as_slice().to_vec(),
        Some(controller()),
    )
    .unwrap();

    // Wait 10 rounds to complete post-upgrade tasks.
    for _ in 0..10 {
        pic.advance_time(std::time::Duration::from_secs(1));
        pic.tick();
    }

    pic.upgrade_canister(
        backend,
        get_wasm("taggr"),
        controller().as_slice().to_vec(),
        Some(controller()),
    )
    .unwrap();

    // Wait 10 rounds to complete post-upgrade tasks.
    for _ in 0..10 {
        pic.advance_time(std::time::Duration::from_secs(1));
        pic.tick();
    }

    let posts = &posts(&pic, backend, controller(), post_ids.clone());

    for (post_id, (post, body)) in post_ids.iter().zip(posts.iter().zip(bodies.iter())) {
        let post: &serde_json::Value = if post.is_array() { &post[0] } else { post };
        assert_eq!(post.get("id").unwrap().as_u64().unwrap(), *post_id);
        assert_eq!(post.get("body").unwrap().as_str().unwrap(), *body);
    }
}

#[test]
fn test_upgrade_from_snapshot() {
    let snapshot = Path::new("./snapshot");
    let old_wasm = Path::new("./snapshot/taggr.wasm.gz");
    if !snapshot.exists() {
        eprintln!("Skipping test_upgrade_from_snapshot because there is no snapshot");
        return;
    }
    let (pic, backend) = setup_from_snapshot(old_wasm, snapshot);

    let old_users = users(&pic, backend, controller());
    assert!(old_users.len() >= 4000);
    assert_eq!(old_users[0].as_array().unwrap()[0].as_u64().unwrap(), 0);
    assert_eq!(old_users[0].as_array().unwrap()[1].as_str().unwrap(), "X");

    let old_posts = journal(&pic, backend, controller(), "X");
    assert!(old_posts.len() >= 10);

    pic.upgrade_canister(
        backend,
        get_wasm("taggr"),
        controller().as_slice().to_vec(),
        Some(controller()),
    )
    .unwrap();

    // Wait 10 rounds to complete post-upgrade tasks.
    for _ in 0..10 {
        pic.advance_time(std::time::Duration::from_secs(1));
        pic.tick();
    }

    let new_users = users(&pic, backend, controller());
    assert_eq!(old_users, new_users);

    let new_posts = journal(&pic, backend, controller(), "X");
    assert_eq!(old_posts, new_posts);
}
