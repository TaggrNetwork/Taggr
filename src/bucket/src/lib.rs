use candid::Principal;
use ic_cdk::api::{
    self,
    call::{arg_data_raw, reply_raw},
    canister_balance,
    stable::*,
};

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
    api::stable::stable64_write(0, &initial_offset.to_be_bytes());
    set_controller();
}

#[export_name = "canister_post_upgrade"]
fn post_upgrade() {
    set_controller();
}

#[export_name = "canister_query balance"]
fn balance() {
    reply_raw(&canister_balance().to_be_bytes())
}

#[export_name = "canister_query read"]
fn read() {
    let args = &arg_data_raw();
    let offset = bytes_to_u64(args, 0);
    let len = bytes_to_u64(args, 8);
    let mut buf = Vec::with_capacity(len as usize);
    buf.spare_capacity_mut();
    unsafe {
        buf.set_len(len as usize);
    }
    stable64_read(offset, &mut buf);
    reply_raw(&buf);
}

#[export_name = "canister_update update_pointer"]
fn update_pointer() {
    assert_controller();
    let blob = arg_data_raw();
    api::stable::stable64_write(0, &blob);
    reply_raw(&blob);
}

#[export_name = "canister_update write"]
fn write() {
    assert_controller();
    let mut offset_bytes: [u8; 8] = Default::default();
    api::stable::stable64_read(0, &mut offset_bytes);
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
    stable64_write(offset, blob);
    if update_pointer {
        let new_offset = offset + blob.len() as u64;
        api::stable::stable64_write(0, &new_offset.to_be_bytes());
    }
    reply_raw(&offset.to_be_bytes());
}

fn grow_to_fit(offset: u64, len: u64) {
    if offset + len < (stable64_size() << 16) {
        return;
    }
    // amount of extra 64kb pages to reserve
    let extra_wasm_pages = 200;
    if stable64_grow((len >> 16) + extra_wasm_pages).is_err() {
        panic!("couldn't grow stable memory");
    }
}

fn bytes_to_u64(bytes: &[u8], offset: usize) -> u64 {
    let mut arr: [u8; 8] = Default::default();
    arr.copy_from_slice(&bytes[offset..offset + 8]);
    u64::from_be_bytes(arr)
}
