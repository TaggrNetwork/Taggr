use bitcoin::{Address, Network, PublicKey};
use ic_cdk::api::management_canister::ecdsa::{EcdsaCurve, EcdsaKeyId, EcdsaPublicKeyArgument};

use super::config::CONFIG;

/// Returns the P2PKH address of this canister at the given derivation path.
pub async fn get_address(derivation_path: Vec<Vec<u8>>) -> String {
    // Fetch the public key of the given derivation path.
    let public_key = get_ecdsa_public_key(CONFIG.ecdsa_key_name.into(), derivation_path).await;

    // Compute the address.
    Address::p2pkh(
        &PublicKey::from_slice(&public_key).expect("failed to parse public key"),
        Network::from_core_arg(CONFIG.btc_network).expect("couldn't parse metwork id"),
    )
    .to_string()
}

/// Returns the ECDSA public key of this canister at the given derivation path.
async fn get_ecdsa_public_key(key_name: String, derivation_path: Vec<Vec<u8>>) -> Vec<u8> {
    // Retrieve the public key of this canister at the given derivation path
    // from the ECDSA API.
    let key_id = EcdsaKeyId {
        curve: EcdsaCurve::Secp256k1,
        name: key_name,
    };

    let res: ic_cdk::api::call::CallResult<(
        ic_cdk::api::management_canister::ecdsa::EcdsaPublicKeyResponse,
    )> = ic_cdk::call(
        candid::Principal::management_canister(),
        "ecdsa_public_key",
        (EcdsaPublicKeyArgument {
            canister_id: None, // defaults to this canister id
            derivation_path: derivation_path.clone(),
            key_id,
        },),
    )
    .await;

    res.unwrap().0.public_key
}
