use candid::{decode_one, encode_args, encode_one, Principal};
use ic_cdk::api::management_canister::main::CanisterId;
use pocket_ic::{PocketIc, WasmResult};

use crate::{controller, get_wasm, setup};

fn create_test_user(pic: &PocketIc, backend: CanisterId, caller: Principal, name: &str) -> u64 {
    let result = pic
        .update_call(
            backend,
            caller,
            "create_test_user",
            encode_one(name).unwrap(),
        )
        .unwrap();

    let user_id: u64 = match result {
        WasmResult::Reply(blob) => decode_one(&blob).unwrap(),
        WasmResult::Reject(err) => unreachable!("{}", err),
    };
    user_id
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

    let result = pic
        .update_call(
            backend,
            caller,
            "add_post",
            encode_args((body, blobs, parent, realm, extension)).unwrap(),
        )
        .unwrap();

    let maybe_post_id: Result<u64, String> = match result {
        WasmResult::Reply(blob) => decode_one(&blob).unwrap(),
        WasmResult::Reject(err) => unreachable!("{}", err),
    };

    maybe_post_id
}

fn posts(
    pic: &PocketIc,
    backend: CanisterId,
    caller: Principal,
    post_ids: Vec<u64>,
) -> Vec<serde_json::Value> {
    let result = pic
        .query_call(
            backend,
            caller,
            "posts",
            serde_json::json!(post_ids).to_string().as_bytes().to_vec(),
        )
        .unwrap();

    let json: String = match result {
        WasmResult::Reply(blob) => String::from_utf8(blob).unwrap(),
        WasmResult::Reject(err) => unreachable!("{}", err),
    };

    let posts: serde_json::Value = serde_json::from_str(&json).unwrap();
    let posts = posts.as_array().unwrap();
    posts.clone()
}

#[test]
fn test_add_post() {
    let (pic, backend) = setup("taggr");

    let _user_id = create_test_user(&pic, backend, controller(), "test");
    let post_id = add_post(&pic, backend, controller(), "lorem ipsum", vec![], None).unwrap();
    let post = &posts(&pic, backend, controller(), vec![post_id])[0];

    assert_eq!(post.get("id").unwrap().as_u64().unwrap(), post_id);
    assert_eq!(post.get("body").unwrap().as_str().unwrap(), "lorem ipsum");
}

#[test]
fn test_upgrades() {
    let (pic, backend) = setup("taggr");

    let _user_id = create_test_user(&pic, backend, controller(), "test");

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

    // Skip a few rounds to wait until the upgrade rate limitting stops.
    for _ in 0..10 {
        pic.tick();
    }

    pic.upgrade_canister(
        backend,
        get_wasm("taggr"),
        controller().as_slice().to_vec(),
        Some(controller()),
    )
    .unwrap();

    let posts = &posts(&pic, backend, controller(), post_ids.clone());

    for (post_id, (post, body)) in post_ids.iter().zip(posts.iter().zip(bodies.iter())) {
        assert_eq!(post.get("id").unwrap().as_u64().unwrap(), *post_id);
        assert_eq!(post.get("body").unwrap().as_str().unwrap(), *body);
    }
}
