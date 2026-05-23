// Legacy shared-bucket plumbing. `Storage::buckets` records the IDs of buckets
// that taggr used to own; they remain in state so taggr can still call `free`
// on them for posts that haven't been migrated. NO writes happen here anymore
// — new images go directly to per-user buckets via the bucket WASM's `write`
// method, signed by the user. The shared bucket is no longer topped up and
// will be retired wholesale in a follow-up.

use crate::{canisters, mutate};
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

impl Storage {
    /// Frees blobs on their respective bucket canisters.
    /// The `files` map has keys in the format `"blob_id@bucket_principal"`
    /// and values of `(offset, length)`.
    pub async fn free_blobs(files: BTreeMap<String, (u64, usize)>) {
        let mut by_bucket: BTreeMap<Principal, Vec<(u64, u64)>> = BTreeMap::new();
        for (key, (offset, length)) in &files {
            if let Some(bucket_id) = key
                .rsplit_once('@')
                .and_then(|(_, b)| b.parse::<Principal>().ok())
            {
                by_bucket
                    .entry(bucket_id)
                    .or_default()
                    .push((*offset, *length as u64));
            }
        }

        for (bucket_id, segments) in by_bucket {
            if let Err(err) =
                canisters::call_canister::<_, ()>(bucket_id, "free", (segments.clone(),)).await
            {
                mutate(|state| {
                    state.logger.error(format!(
                        "couldn't free blobs on bucket {}: {:?}, segments: {:?}",
                        bucket_id, err, segments
                    ))
                });
            }
        }
    }
}
