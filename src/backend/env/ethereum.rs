use super::canisters;
use super::config::CONFIG;
use crate::{mutate, read};
use candid::Principal;
use ic_cdk_management_canister::{
    EcdsaCurve, EcdsaKeyId, EcdsaPublicKeyArgs, EcdsaPublicKeyResult,
};
use k256::elliptic_curve::sec1::ToEncodedPoint;
use tiny_keccak::{Hasher, Keccak};

pub const DERIVATION_PATH: &[u8] = b"ethereum";

pub async fn update_eth_key() {
    if !read(|state| state.eth_public_key.is_empty()) {
        return;
    }

    match get_ecdsa_public_key().await {
        Ok(public_key) => mutate(|state| state.eth_public_key = public_key),
        Err(err) => mutate(|state| {
            state
                .logger
                .error(format!("couldn't derive the Ethereum public key: {}", err))
        }),
    }
}

pub async fn get_ecdsa_public_key() -> Result<Vec<u8>, String> {
    let key_id = EcdsaKeyId {
        curve: EcdsaCurve::Secp256k1,
        name: CONFIG.ecdsa_key_name.into(),
    };

    let (result,): (EcdsaPublicKeyResult,) = canisters::call_canister(
        Principal::management_canister(),
        "ecdsa_public_key",
        (EcdsaPublicKeyArgs {
            canister_id: None,
            derivation_path: vec![DERIVATION_PATH.to_vec()],
            key_id,
        },),
    )
    .await
    .map_err(|err| format!("ecdsa_public_key call failed: {:?}", err))?;

    Ok(result.public_key)
}

pub fn address_from_public_key(public_key: &[u8]) -> Result<String, String> {
    let point = k256::PublicKey::from_sec1_bytes(public_key)
        .map_err(|err| format!("invalid ECDSA public key: {:?}", err))?
        .to_encoded_point(false);
    let hash = keccak256(&point.as_bytes()[1..]);
    Ok(eip55(&hash[12..]))
}

fn keccak256(data: &[u8]) -> [u8; 32] {
    let mut hasher = Keccak::v256();
    hasher.update(data);
    let mut output = [0u8; 32];
    hasher.finalize(&mut output);
    output
}

fn eip55(address: &[u8]) -> String {
    let address = hex::encode(address);
    let hash = hex::encode(keccak256(address.as_bytes()));
    let checksummed: String = address
        .chars()
        .zip(hash.chars())
        .map(|(c, h)| {
            if h.to_digit(16).unwrap() > 7 {
                c.to_ascii_uppercase()
            } else {
                c
            }
        })
        .collect();
    format!("0x{}", checksummed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derives_known_address() {
        let public_key =
            hex::decode("0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798")
                .unwrap();
        assert_eq!(
            address_from_public_key(&public_key).unwrap(),
            "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf"
        );
    }

    #[test]
    fn rejects_invalid_public_key() {
        assert!(address_from_public_key(&[0u8; 33]).is_err());
    }
}
