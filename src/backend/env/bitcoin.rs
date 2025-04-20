use super::canisters;
use super::config::CONFIG;
use bitcoin::{Address, Network, PublicKey};
use candid::Principal;
use ic_cdk::api::management_canister::bitcoin::BitcoinNetwork;
use ic_cdk::api::{
    call::CallResult,
    management_canister::{
        bitcoin::{bitcoin_get_balance, GetBalanceRequest},
        ecdsa::{EcdsaCurve, EcdsaKeyId, EcdsaPublicKeyArgument, EcdsaPublicKeyResponse},
    },
};

pub fn network() -> Network {
    Network::from_core_arg(CONFIG.btc_network).expect("couldn't parse metwork id")
}

pub fn btc_network() -> BitcoinNetwork {
    match CONFIG.btc_network {
        "main" => BitcoinNetwork::Mainnet,
        _ => BitcoinNetwork::Testnet,
    }
}

/// Returns the P2PKH address of this canister at the given derivation path.
pub async fn get_address(derivation_path: &Vec<Vec<u8>>) -> String {
    // Fetch the public key of the given derivation path.
    let public_key = get_ecdsa_public_key(CONFIG.ecdsa_key_name.into(), derivation_path).await;

    // Compute the address.
    Address::p2pkh(
        &PublicKey::from_slice(&public_key).expect("failed to parse public key"),
        network(),
    )
    .to_string()
}

/// Returns the ECDSA public key of this canister at the given derivation path.
pub async fn get_ecdsa_public_key(key_name: String, derivation_path: &Vec<Vec<u8>>) -> Vec<u8> {
    // Retrieve the public key of this canister at the given derivation path
    // from the ECDSA API.
    let key_id = EcdsaKeyId {
        curve: EcdsaCurve::Secp256k1,
        name: key_name,
    };

    let res: CallResult<(EcdsaPublicKeyResponse,)> = canisters::call_canister(
        Principal::management_canister(),
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

pub async fn balance(address: String) -> Result<u64, String> {
    canisters::open_call("btc_balance");
    let balance_res = bitcoin_get_balance(GetBalanceRequest {
        address,
        network: super::bitcoin::btc_network(),
        min_confirmations: None,
    })
    .await
    .map_err(|err| format!("bitcoin_get_balance call failed: {:?}", err))?;
    canisters::close_call("btc_balance");

    Ok(balance_res.0)
}
