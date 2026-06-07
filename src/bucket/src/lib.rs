use candid::{CandidType, Decode, Deserialize, Encode, Principal};
use ic_cdk::api::{
    msg_arg_data, msg_caller, msg_reply, stable_grow, stable_read, stable_size, stable_write, time,
};
use serde::Serialize;
use serde_bytes::ByteBuf;
use std::cell::RefCell;

mod url;

// An upper bound on the blob size. Queries above this size will be rejected
// without trying to read the stable memory.
const MAX_BLOB_SIZE: u64 = 8 * 1024 * 1024;

// Minimum remainder size (5KB) to keep when splitting a free segment.
const MIN_REMAINDER: u64 = 5 * 1024;

// Delegate session lifetime: 4 weeks in nanoseconds. Mirrors the backend
// delegation TTL so a custom-domain session and its bucket session expire alike.
const SESSION_TTL: u64 = 4 * 7 * 24 * 60 * 60 * 1_000_000_000;

// Stable memory layout:
//   [0, 8)              u64 (be): high-water-mark — offset of the next blob write.
//   [8, 12)             u32 (be): length of the candid-encoded controllers list.
//   [12, 268)           candid-encoded `Vec<Principal>` (padded; rewritten in place).
//   [268, ..)           blob data, then optionally the free-list block at upgrade time.
const CONTROLLERS_LEN_OFFSET: u64 = 8;
const CONTROLLERS_BLOB_OFFSET: u64 = 12;
const CONTROLLERS_REGION_END: u64 = 268;
const CONTROLLERS_BLOB_MAX_LEN: u64 = CONTROLLERS_REGION_END - CONTROLLERS_BLOB_OFFSET;

// HTTP request and response headers.
type Headers = Vec<(String, String)>;

#[derive(Clone, Copy, CandidType, Deserialize)]
struct Segment {
    start: u64,
    length: u64,
}

thread_local! {
    static FREE_SEGMENTS: RefCell<Vec<Segment>> = const { RefCell::new(Vec::new()) };
    static CONTROLLERS: RefCell<Vec<Principal>> = const { RefCell::new(Vec::new()) };
    // Authorized delegate sessions: (principal, expiry_ns). Ephemeral by design —
    // dropped on upgrade, in which case custom-domain users re-authorize.
    static SESSIONS: RefCell<Vec<(Principal, u64)>> = const { RefCell::new(Vec::new()) };
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

fn write_controllers(controllers: &[Principal]) {
    assert!(!controllers.is_empty(), "controllers must not be empty");
    let bytes = Encode!(&controllers.to_vec()).expect("couldn't encode controllers");
    let len = bytes.len() as u32;
    assert!(
        (len as u64) <= CONTROLLERS_BLOB_MAX_LEN,
        "controllers blob too large"
    );
    stable_write(CONTROLLERS_LEN_OFFSET, &len.to_be_bytes());
    stable_write(CONTROLLERS_BLOB_OFFSET, &bytes);
    CONTROLLERS.with(|c| *c.borrow_mut() = controllers.to_vec());
}

fn read_controllers() -> Vec<Principal> {
    let mut len_bytes = [0u8; 4];
    stable_read(CONTROLLERS_LEN_OFFSET, &mut len_bytes);
    let len = u32::from_be_bytes(len_bytes) as u64;
    if len == 0 || len > CONTROLLERS_BLOB_MAX_LEN {
        return Vec::new();
    }
    let mut bytes = vec![0u8; len as usize];
    stable_read(CONTROLLERS_BLOB_OFFSET, &mut bytes);
    Decode!(&bytes, Vec<Principal>).unwrap_or_default()
}

fn assert_controller() {
    let caller = msg_caller();
    CONTROLLERS.with(|c| {
        assert!(c.borrow().contains(&caller), "unauthorized caller");
    });
}

// Authorizes a controller or a non-expired delegate session. Used for data
// operations (`write`/`free`) so custom-domain users acting through a delegate
// identity can manage their own bucket.
fn assert_authorized() {
    let caller = msg_caller();
    if CONTROLLERS.with(|c| c.borrow().contains(&caller)) {
        return;
    }
    let now = time();
    let authorized = SESSIONS.with(|s| {
        s.borrow()
            .iter()
            .any(|(principal, expiry)| *principal == caller && *expiry > now)
    });
    assert!(authorized, "unauthorized caller");
}

/// Registers a delegate session principal authorized to `write`/`free` until the
/// TTL elapses. Controller-only: this is called on the canonical domain, where
/// the signer is the user (a bucket controller), at delegation-authorization time.
#[ic_cdk_macros::update]
fn add_session(principal: Principal) {
    assert_controller();
    let now = time();
    SESSIONS.with(|s| {
        let mut sessions = s.borrow_mut();
        // Lazy cleanup (the bucket has no timer) plus dedup of this principal.
        sessions.retain(|(p, expiry)| *expiry > now && *p != principal);
        sessions.push((principal, now + SESSION_TTL));
    });
}

#[export_name = "canister_init"]
fn init() {
    grow_to_fit(0, CONTROLLERS_REGION_END);
    stable_write(0, &CONTROLLERS_REGION_END.to_be_bytes());
    let controllers: Vec<Principal> =
        Decode!(&msg_arg_data(), Vec<Principal>).expect("couldn't decode controllers list");
    write_controllers(&controllers);
}

#[export_name = "canister_pre_upgrade"]
fn pre_upgrade() {
    let offset = read_offset();

    FREE_SEGMENTS.with(|fl| {
        let bytes = Encode!(&*fl.borrow()).expect("couldn't serialize free list");
        let len = bytes.len() as u64;
        grow_to_fit(offset, 8 + len);
        stable_write(offset, &len.to_be_bytes());
        stable_write(offset + 8, &bytes);
    });
}

#[export_name = "canister_post_upgrade"]
fn post_upgrade() {
    // Controllers persist in their fixed stable-memory region; just rehydrate the cache.
    let controllers = read_controllers();
    CONTROLLERS.with(|c| *c.borrow_mut() = controllers);

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
        FREE_SEGMENTS.with(|fl| *fl.borrow_mut() = free_list);
    }
}

fn read_offset() -> u64 {
    let mut bytes: [u8; 8] = Default::default();
    stable_read(0, &mut bytes);
    u64::from_be_bytes(bytes)
}

#[ic_cdk_macros::query]
fn stats() -> (usize, u64) {
    FREE_SEGMENTS.with(|fl| {
        let free_list = fl.borrow();
        let total: u64 = free_list.iter().map(|s| s.length).sum();
        (free_list.len(), total)
    })
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
    assert_authorized();
    let blob = msg_arg_data();
    let blob_len = blob.len() as u64;

    let offset = FREE_SEGMENTS.with(|fl| {
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
                stable_write(0, &new_offset.to_be_bytes());
                offset
            }
        }
    });

    stable_write(offset, &blob);
    msg_reply(offset.to_be_bytes());
}

#[ic_cdk_macros::update]
fn free(segments: Vec<(u64, u64)>) {
    assert_authorized();
    FREE_SEGMENTS.with(|fl| {
        let mut free_list = fl.borrow_mut();
        for (start, length) in segments {
            free_list.push(Segment { start, length });
        }
        free_list.sort_by_key(|s| s.length);
    });
}

#[ic_cdk_macros::update]
fn update_internal_controllers(controllers: Vec<Principal>) {
    assert_controller();
    write_controllers(&controllers);
}

fn grow_to_fit(offset: u64, len: u64) {
    if offset + len < (stable_size() << 16) {
        return;
    }
    // amount of extra 64kb pages to reserve
    let extra_wasm_pages = 200;
    if stable_grow((len >> 16) + extra_wasm_pages) == u64::MAX {
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
