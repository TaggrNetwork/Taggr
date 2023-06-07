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
    async fn allocate_space(max_bucket_size: u64) -> Result<Principal, String> {
        if let Some(id) = read(|state| {
            state
                .storage
                .buckets
                .iter()
                .find_map(|(id, size)| (*size < max_bucket_size).then_some(*id))
        }) {
            return Ok(id);
        }
        let id = crate::canisters::new().await?;
        mutate(|state| {
            state.storage.buckets.insert(id, 0);
            state.logger.info(format!("New bucket {} created.", id));
        });
        canisters::install(id, BUCKET_WASM_GZ, CanisterInstallMode::Install).await?;
        mutate(|state| {
            state
                .logger
                .info(format!("WASM installed to bucket {}.", id));
        });
        Ok(id)
    }

    #[allow(dead_code)]
    async fn upgrade_buckets(&self) -> Result<(), String> {
        for id in self.buckets.keys() {
            canisters::install(*id, BUCKET_WASM_GZ, CanisterInstallMode::Upgrade).await?;
        }
        Ok(())
    }

    pub async fn write_to_bucket(blob: &[u8]) -> Result<(Principal, u64), String> {
        let id = Storage::allocate_space(CONFIG.max_bucket_size).await?;
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
