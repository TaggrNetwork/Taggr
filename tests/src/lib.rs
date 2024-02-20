#![cfg(test)]

use std::path::PathBuf;

use candid::Principal;
use ic_cdk::api::management_canister::main::CanisterId;
use pocket_ic::PocketIc;

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
    std::fs::read(path).unwrap_or_else(|_| panic!("{:?} wasm file not found", path))
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
