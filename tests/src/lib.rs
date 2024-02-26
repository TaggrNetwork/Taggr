#![cfg(test)]

use std::path::{Path, PathBuf};

use candid::{decode_one, encode_one, Principal};
use ic_cdk::api::management_canister::main::CanisterId;
use pocket_ic::{common::rest::BlobCompression, PocketIc};

const BACKUP_PAGE_SIZE: usize = 1024 * 1024;

mod backend_tests;
mod bucket_tests;

fn controller() -> Principal {
    // Any valid principal would work here.
    // This one is the principal of the local minter.
    Principal::from_text("hpikg-6exdt-jn33w-ndty3-fc7jc-tl2lr-buih3-cs3y7-tftkp-sfp62-gqe").unwrap()
}

fn get_wasm(name: &str) -> Vec<u8> {
    let mut path = PathBuf::new();
    path.push("..");
    path.push("target");
    path.push("wasm32-unknown-unknown");
    path.push("release");
    path.push(format!("{}.wasm.gz", name));
    let path = path.as_path();
    std::fs::read(path).unwrap_or_else(|_| panic!("wasm binary not found: {:?}", path))
}

fn setup(canister: &str) -> (PocketIc, CanisterId) {
    let pic = PocketIc::new();
    let canister_id = pic.create_canister_with_settings(Some(controller()), None);
    pic.add_cycles(canister_id, 1_000_000_000_000);
    pic.install_canister(
        canister_id,
        get_wasm(canister),
        controller().as_slice().to_vec(),
        Some(controller()),
    );
    (pic, canister_id)
}

/// Setups up the backend canister based on the backup data downloaded in the
/// given snapshot directory and the Wasm binary (built in dev mode)
/// corresponding to the version that produced the data.
fn setup_from_snapshot(wasm: &Path, snapshot_dir: &Path) -> (PocketIc, CanisterId) {
    let wasm_binary =
        std::fs::read(wasm).unwrap_or_else(|_| panic!("wasm binary not found: {:?}", wasm));

    let mut stable_memory = vec![];
    let mut page = 0;

    loop {
        let mut path = PathBuf::from(snapshot_dir);
        path.push(format!("page{}.bin", page));

        let encoded = std::fs::read(path.as_path())
            .unwrap_or_else(|_| panic!("page file not found: {:?}", path.as_path()));

        let pages: Vec<(u64, Vec<u8>)> = decode_one(&encoded).unwrap();

        if pages.is_empty() {
            break;
        }

        for (index, bytes) in pages.into_iter() {
            let offset = index as usize * BACKUP_PAGE_SIZE;
            if offset + bytes.len() > stable_memory.len() {
                stable_memory.resize(offset + bytes.len(), 0);
            }
            stable_memory[offset..offset + bytes.len()].copy_from_slice(&bytes);
        }
        page += 1;
    }

    let pic = PocketIc::new();
    let canister_id = pic.create_canister_with_settings(Some(controller()), None);
    pic.add_cycles(canister_id, 1_000_000_000_000);

    // Install an empty Wasm module and replace its stable memory.
    let empty_wasm = vec![0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
    pic.install_canister(
        canister_id,
        empty_wasm,
        controller().as_slice().to_vec(),
        Some(controller()),
    );
    pic.set_stable_memory(canister_id, stable_memory, BlobCompression::NoCompression);

    // Now upgrade to Taggr code based on the stable memory.
    pic.upgrade_canister(
        canister_id,
        wasm_binary,
        controller().as_slice().to_vec(),
        Some(controller()),
    )
    .unwrap();

    // Wait 10 rounds to complete post-upgrade tasks.
    for _ in 0..10 {
        pic.advance_time(std::time::Duration::from_secs(1));
        pic.tick();
    }

    pic.update_call(
        canister_id,
        controller(),
        "clear_buckets",
        encode_one(()).unwrap(),
    )
    .unwrap();
    (pic, canister_id)
}
