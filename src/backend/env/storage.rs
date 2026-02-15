use crate::{
    canisters::{self},
    mutate, read,
};
use candid::Principal;
use ic_cdk::api::management_canister::main::CanisterInstallMode;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

use super::config::CONFIG;

#[derive(Default, Serialize, Deserialize)]
pub struct Storage {
    pub buckets: BTreeMap<Principal, u64>,
}

const BUCKET_WASM_GZ: &[u8] =
    include_bytes!("../../../target/wasm32-unknown-unknown/release/bucket.wasm.gz");

impl Storage {
    async fn allocate_space() -> Result<(Principal, u64), String> {
        if let Some((id, offset)) = read(|state| {
            state
                .storage
                .buckets
                .iter()
                .find_map(|(id, size)| (*size < CONFIG.max_bucket_size).then_some((*id, *size)))
        }) {
            return Ok((id, offset));
        }
        let id = crate::canisters::new().await?;
        let init_offset = 8;
        mutate(|state| {
            state.storage.buckets.insert(id, init_offset);
            state.logger.debug(format!("New bucket {} created.", id));
        });
        canisters::install(id, BUCKET_WASM_GZ, CanisterInstallMode::Install).await?;
        mutate(|state| {
            state
                .logger
                .debug(format!("WASM installed to bucket {}.", id));
        });
        Ok((id, init_offset))
    }

    pub async fn write_to_bucket(blob: &[u8]) -> Result<(Principal, u64), String> {
        let (id, curr_offset) = Storage::allocate_space().await?;
        let response = canisters::call_canister_raw(id, "write", blob)
            .await
            .map_err(|err| format!("couldn't call write on a bucket: {:?}", err))?;
        let mut offset_bytes: [u8; 8] = Default::default();
        offset_bytes.copy_from_slice(&response);
        let offset = u64::from_be_bytes(offset_bytes);
        let new_offset = offset + blob.len() as u64;
        mutate(|state| {
            state
                .storage
                .buckets
                .insert(id, curr_offset.max(new_offset))
        });
        Ok((id, offset))
    }

    /// Frees blobs on their respective bucket canisters.
    /// The `files` map has keys in the format `"blob_id@bucket_principal"`
    /// and values of `(offset, length)`.
    pub async fn free_blobs(files: BTreeMap<String, (u64, usize)>) {
        // Group blobs by bucket canister.
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
                canisters::call_canister::<_, ()>(bucket_id, "free", (segments,)).await
            {
                mutate(|state| {
                    state.logger.error(format!(
                        "couldn't free blobs on bucket {}: {:?}",
                        bucket_id, err
                    ))
                });
            }
        }
    }
}

#[allow(dead_code)]
pub async fn upgrade_buckets() {
    for id in read(|state| state.storage.buckets.keys().cloned().collect::<Vec<_>>()) {
        if let Err(err) =
            canisters::install(id, BUCKET_WASM_GZ, CanisterInstallMode::Upgrade(None)).await
        {
            mutate(|state| {
                state
                    .logger
                    .error(format!("couldn't upgrade bucket {}: {}", id, err))
            });
        };
    }
    mutate(|state| {
        state
            .logger
            .debug("Successfully upgraded all storage buckets.")
    });
}
