// Legacy shared-bucket plumbing. `Storage::buckets` records the IDs of buckets
// that taggr used to own; they remain in state only for read-only inventory
// (the shared bucket is no longer written to or freed from, and will be retired
// wholesale in a follow-up). Taggr no longer holds any controller rights on
// user buckets and never issues `free` calls on either shared or user buckets.

use candid::Principal;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Default, Serialize, Deserialize)]
pub struct Storage {
    // Read-only inventory of legacy shared buckets.
    pub buckets: BTreeMap<Principal, u64>,
}

pub const BUCKET_WASM_GZ: &[u8] =
    include_bytes!("../../../target/wasm32-unknown-unknown/release/bucket.wasm.gz");
