use candid::{CandidType, Decode, Deserialize, Encode, Principal};
use ic_cdk::api::{
    self,
    call::{arg_data_raw, reply_raw},
    canister_balance,
    stable::*,
};
use serde::Serialize;
use serde_bytes::ByteBuf;
use std::cell::RefCell;

mod url;

// An upper bound on the blob size. Queries above this size will be rejected
// without trying to read the stable memory.
const MAX_BLOB_SIZE: u64 = 8 * 1024 * 1024;

// Minimum remainder size (50KB) to keep when splitting a free segment.
const MIN_REMAINDER: u64 = 50 * 1024;

// HTTP request and response headers.
type Headers = Vec<(String, String)>;

#[derive(Clone, Copy, CandidType, Deserialize)]
struct Segment {
    start: u64,
    length: u64,
}

thread_local! {
    static FREE_LIST: RefCell<Vec<Segment>> = const { RefCell::new(Vec::new()) };
}

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

#[export_name = "canister_pre_upgrade"]
fn pre_upgrade() {
    let offset = read_offset();

    FREE_LIST.with(|fl| {
        let bytes = Encode!(&*fl.borrow()).expect("couldn't serialize free list");
        let len = bytes.len() as u64;
        grow_to_fit(offset, 8 + len);
        stable_write(offset, &len.to_be_bytes());
        stable_write(offset + 8, &bytes);
    });
}

#[export_name = "canister_post_upgrade"]
fn post_upgrade() {
    set_controller();

    let offset = read_offset();
    let stable_mem_size = stable_size() << 16;
    // Not enough stable memory to even read the free-list length header.
    if offset + 8 > stable_mem_size {
        return;
    }

    let mut len_bytes: [u8; 8] = Default::default();
    stable_read(offset, &mut len_bytes);
    let len = u64::from_be_bytes(len_bytes);
    // On first upgrade from old code (no pre_upgrade), stable memory past the
    // high-water mark is zero-initialized, so len will be 0 and we skip gracefully.
    if len == 0 || offset + 8 + len > stable_mem_size {
        return;
    }

    let mut bytes = vec![0u8; len as usize];
    stable_read(offset + 8, &mut bytes);

    if let Ok(free_list) = Decode!(&bytes, Vec<Segment>) {
        FREE_LIST.with(|fl| *fl.borrow_mut() = free_list);
    }
}

fn read_offset() -> u64 {
    let mut bytes: [u8; 8] = Default::default();
    api::stable::stable_read(0, &mut bytes);
    u64::from_be_bytes(bytes)
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
    let blob = arg_data_raw();
    let blob_len = blob.len() as u64;

    let offset = FREE_LIST.with(|fl| {
        let mut free_list = fl.borrow_mut();

        // Binary-search for the smallest free segment that fits.
        // Ok(i) = exact match, Err(i) = next larger segment at index i.
        match free_list.binary_search_by_key(&blob_len, |s| s.length) {
            Ok(idx) | Err(idx) if idx < free_list.len() => {
                let seg = free_list.remove(idx);
                let remainder = seg.length - blob_len;
                if remainder >= MIN_REMAINDER {
                    free_list.push(Segment {
                        start: seg.start + blob_len,
                        length: remainder,
                    });
                    free_list.sort_by_key(|s| s.length);
                }
                seg.start
            }
            _ => {
                // All free segments are too small; append at the end.
                let offset = read_offset();
                grow_to_fit(offset, blob_len);
                let new_offset = offset + blob_len;
                api::stable::stable_write(0, &new_offset.to_be_bytes());
                offset
            }
        }
    });

    stable_write(offset, &blob);
    reply_raw(&offset.to_be_bytes());
}

#[ic_cdk_macros::update]
fn free(segments: Vec<(u64, u64)>) {
    assert_controller();
    FREE_LIST.with(|fl| {
        let mut free_list = fl.borrow_mut();
        for (start, length) in segments {
            free_list.push(Segment { start, length });
        }
        free_list.sort_by_key(|s| s.length);
    });
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
