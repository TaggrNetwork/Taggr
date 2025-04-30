use candid::{CandidType, Deserialize, Principal};
use ic_cdk::api::{
    self,
    call::{arg_data_raw, reply_raw},
    canister_balance,
    stable::*,
};
use serde::Serialize;
use serde_bytes::ByteBuf;

mod url;

// An upper bound on the blob size. Queries above this size will be rejected
// without trying to read the stable memory.
const MAX_BLOB_SIZE: u64 = 8 * 1024 * 1024;

// HTTP request and response headers.
type Headers = Vec<(String, String)>;

#[derive(CandidType, Deserialize)]
struct HttpRequest {
    url: String,
    headers: Headers,
}

#[derive(CandidType, Default, Serialize)]
struct HttpResponse {
    status_code: u16,
    headers: Headers,
    body: ByteBuf,
    upgrade: Option<bool>,
}

static mut CONTROLLER: Option<Principal> = None;

fn set_controller() {
    unsafe {
        CONTROLLER = Some(Principal::from_slice(&arg_data_raw()));
    }
}

fn assert_controller() {
    assert_eq!(api::caller(), unsafe { CONTROLLER.expect("uninitialized") });
}

#[export_name = "canister_init"]
fn init() {
    let initial_offset: u64 = 8;
    grow_to_fit(initial_offset, 0);
    api::stable::stable_write(0, &initial_offset.to_be_bytes());
    set_controller();
}

#[export_name = "canister_post_upgrade"]
fn post_upgrade() {
    set_controller();
}

#[ic_cdk_macros::query]
fn balance() -> u64 {
    canister_balance()
}

#[ic_cdk_macros::query]
fn http_request(req: HttpRequest) -> HttpResponse {
    let url = url::parse(&req.url);
    match url.path {
        "/image" => http_image(url.args),
        _ => HttpResponse {
            status_code: 404,
            ..Default::default()
        },
    }
}

/// Serves a PNG image from the stable memory.
/// It expects the arguments in the form: `offset=123&len=456`.
fn http_image(args: &str) -> HttpResponse {
    const HEADERS: &[(&str, &str)] = &[
        ("Content-Type", "image/png"),
        ("Cache-Control", "public, max-age=1000000"),
    ];

    fn error(msg: &str) -> HttpResponse {
        HttpResponse {
            status_code: 400,
            body: ByteBuf::from(msg.as_bytes()),
            ..Default::default()
        }
    }

    let offset = url::find_arg_value(args, "offset=").and_then(|v| v.parse::<u64>().ok());

    let len = url::find_arg_value(args, "len=").and_then(|v| v.parse::<u64>().ok());

    if offset.is_none() || len.is_none() {
        return error("Invalid or missing arguments");
    }

    match read_blob(offset.unwrap(), len.unwrap()) {
        Ok(blob) => HttpResponse {
            status_code: 200,
            headers: HEADERS
                .iter()
                .map(|(key, value)| (key.to_string(), value.to_string()))
                .collect(),
            body: ByteBuf::from(blob),
            upgrade: None,
        },
        Err(msg) => error(msg),
    }
}

#[export_name = "canister_update write"]
fn write() {
    assert_controller();
    let mut offset_bytes: [u8; 8] = Default::default();
    api::stable::stable_read(0, &mut offset_bytes);
    let blob = arg_data_raw();
    write_at(u64::from_be_bytes(offset_bytes), &blob, true);
}

#[export_name = "canister_update write_at_offset"]
fn write_at_offset() {
    assert_controller();
    let params = &arg_data_raw();
    let offset = bytes_to_u64(params, 0);
    write_at(offset, &params[8..], false);
}

fn write_at(offset: u64, blob: &[u8], update_pointer: bool) {
    grow_to_fit(offset, blob.len() as u64);
    stable_write(offset, blob);
    if update_pointer {
        let new_offset = offset + blob.len() as u64;
        api::stable::stable_write(0, &new_offset.to_be_bytes());
    }
    reply_raw(&offset.to_be_bytes());
}

fn grow_to_fit(offset: u64, len: u64) {
    if offset + len < (stable_size() << 16) {
        return;
    }
    // amount of extra 64kb pages to reserve
    let extra_wasm_pages = 200;
    if stable_grow((len >> 16) + extra_wasm_pages).is_err() {
        panic!("couldn't grow stable memory");
    }
}

fn bytes_to_u64(bytes: &[u8], offset: usize) -> u64 {
    let mut arr: [u8; 8] = Default::default();
    arr.copy_from_slice(&bytes[offset..offset + 8]);
    u64::from_be_bytes(arr)
}

fn read_blob(offset: u64, len: u64) -> Result<Vec<u8>, &'static str> {
    if offset.saturating_add(len) > (stable_size() << 16) {
        return Err("blob offset and length are invalid");
    }
    if len > MAX_BLOB_SIZE {
        return Err("blob length is too large");
    }
    let mut buf = Vec::with_capacity(len as usize);
    buf.spare_capacity_mut();
    unsafe {
        // SAFETY: The length is equal to the capacity.
        buf.set_len(len as usize);
    }
    stable_read(offset, &mut buf);
    Ok(buf)
}
