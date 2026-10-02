// Wasm module of the per-user storage canister ("bucket"). Served to the
// frontend so users can install it on a canister they own and control.
pub const BUCKET_WASM_GZ: &[u8] =
    include_bytes!("../../../target/wasm32-unknown-unknown/release/bucket.wasm.gz");
