use crate::{
    canisters::{self, CanisterInstallMode},
    mutate, read,
};
use candid::Principal;
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
    async fn allocate_space() -> Result<Principal, String> {
        if let Some(id) = read(|state| {
            state
                .storage
                .buckets
                .iter()
                .find_map(|(id, size)| (*size < CONFIG.max_bucket_size).then_some(*id))
        }) {
            return Ok(id);
        }
        let id = crate::canisters::new().await?;
        mutate(|state| {
            state.storage.buckets.insert(id, 0);
            state.logger.debug(format!("New bucket {} created.", id));
        });
        canisters::install(id, BUCKET_WASM_GZ, CanisterInstallMode::Install).await?;
        mutate(|state| {
            state
                .logger
                .debug(format!("WASM installed to bucket {}.", id));
        });
        Ok(id)
    }

    pub async fn write_to_bucket(blob: &[u8]) -> Result<(Principal, u64), String> {
        let id = Storage::allocate_space().await?;
        let response = canisters::call_canister_raw(id, "write", blob)
            .await
            .map_err(|err| format!("couldn't call write on a bucket: {:?}", err))?;
        let mut offset_bytes: [u8; 8] = Default::default();
        offset_bytes.copy_from_slice(&response);
        let offset = u64::from_be_bytes(offset_bytes);
        mutate(|state| state.storage.buckets.insert(id, offset + blob.len() as u64));
        Ok((id, offset))
    }
}

#[allow(dead_code)]
pub async fn upgrade_buckets() {
    for id in read(|state| state.storage.buckets.keys().cloned().collect::<Vec<_>>()) {
        if let Err(err) = canisters::install(id, BUCKET_WASM_GZ, CanisterInstallMode::Upgrade).await
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
