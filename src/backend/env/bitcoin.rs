/// Most of the code in this file was originally copied from https://github.com/dfinity/examples/tree/master/rust/basic_bitcoin
use crate::{mutate, read};

use super::canisters;
use super::config::CONFIG;
use bitcoin::script::{Builder, PushBytesBuf};
use bitcoin::sighash::SighashCache;
use bitcoin::transaction::Version;
use bitcoin::{
    absolute, consensus::serialize, hashes::Hash, Address, Network, OutPoint, PublicKey,
    Transaction, TxIn, TxOut, Txid,
};
use bitcoin::{Amount, EcdsaSighashType, ScriptBuf, Sequence, Witness};
use candid::Principal;
use ic_cdk::api::management_canister::bitcoin::{
    bitcoin_get_current_fee_percentiles, bitcoin_get_utxos, bitcoin_send_transaction,
    BitcoinNetwork, GetCurrentFeePercentilesRequest, GetUtxosRequest, Satoshi,
    SendTransactionRequest, Utxo,
};
use ic_cdk::api::management_canister::ecdsa::{SignWithEcdsaArgument, SignWithEcdsaResponse};
use ic_cdk::api::management_canister::{
    bitcoin::{bitcoin_get_balance, GetBalanceRequest},
    ecdsa::{EcdsaCurve, EcdsaKeyId, EcdsaPublicKeyArgument, EcdsaPublicKeyResponse},
};
use std::convert::TryFrom;
use std::str::FromStr;

// Default derivation path, used for the treasury address.
const DERIVATION_PATH: Vec<Vec<u8>> = vec![];

pub fn network() -> Network {
    Network::from_core_arg(CONFIG.btc_network).expect("couldn't parse metwork id")
}

pub fn btc_network() -> BitcoinNetwork {
    match CONFIG.btc_network {
        "main" => BitcoinNetwork::Mainnet,
        _ => BitcoinNetwork::Testnet,
    }
}

pub async fn update_treasury_address() {
    let main_address = get_address(DERIVATION_PATH.clone())
        .await
        .expect("couldn't create treasury address");
    mutate(|state| state.bitcoin_treasury_address = main_address)
}

pub async fn update_treasury_balance() {
    let main_address = read(|state| state.bitcoin_treasury_address.clone());
    let result = balance(main_address).await;
    mutate(|state| match result {
        Ok(sats) => state.bitcoin_treasury_sats = sats,
        Err(err) => state
            .logger
            .error(format!("Bitcoin treasury balance update failed: {}", err)),
    })
}

/// Returns the P2PKH address of this canister at the given derivation path.
pub async fn get_address(derivation_path: Vec<Vec<u8>>) -> Result<String, String> {
    let public_key = get_ecdsa_public_key(CONFIG.ecdsa_key_name.into(), derivation_path).await?;
    Ok(Address::p2pkh(
        PublicKey::from_slice(&public_key)
            .map_err(|err| format!("couldn't parse pubkey: {:?}", err))?,
        network(),
    )
    .to_string())
}

/// Returns the ECDSA public key of this canister at the given derivation path.
pub async fn get_ecdsa_public_key(
    key_name: String,
    derivation_path: Vec<Vec<u8>>,
) -> Result<Vec<u8>, String> {
    let key_id = EcdsaKeyId {
        curve: EcdsaCurve::Secp256k1,
        name: key_name,
    };

    let res: (EcdsaPublicKeyResponse,) = canisters::call_canister(
        Principal::management_canister(),
        "ecdsa_public_key",
        (EcdsaPublicKeyArgument {
            canister_id: None, // defaults to this canister id
            derivation_path,
            key_id,
        },),
    )
    .await
    .map_err(|err| format!("call failed: {:?}", err))?;

    Ok(res.0.public_key)
}

pub async fn balance(address: String) -> Result<u64, String> {
    let method = "bitcoin_get_balance";
    canisters::open_call(method);
    let balance_res = bitcoin_get_balance(GetBalanceRequest {
        address,
        network: super::bitcoin::btc_network(),
        min_confirmations: None,
    })
    .await
    .map_err(|err| format!("bitcoin_get_balance call failed: {:?}", err))?;
    canisters::close_call(method);

    Ok(balance_res.0)
}

// Transfers all funds from the given address.
pub async fn transfer(
    own_address: String,
    derivation_path: Vec<Vec<u8>>,
    dst_address: String,
    fee_percentile: usize,
) -> Result<Txid, String> {
    ic_cdk::println!(
        "Processing address {} with fee_percentile={}",
        &own_address,
        fee_percentile
    );
    let fee_per_byte = get_fee_per_byte(fee_percentile).await?;

    let utxos = get_utxos(own_address).await?;

    let network = network();
    let own_public_key =
        get_ecdsa_public_key(CONFIG.ecdsa_key_name.into(), derivation_path.clone()).await?;
    let own_address = Address::from_str(get_address(derivation_path.clone()).await?.as_str())
        .map_err(|err| format!("couldn't get address: {}", err))?
        .require_network(network)
        .map_err(|err| format!("should be valid address for the network: {}", err))?;

    let dst_address = Address::from_str(&dst_address)
        .map_err(|err| format!("couldn't get address: {}", err))?
        .require_network(network)
        .map_err(|err| format!("should be valid address for the network: {}", err))?;

    // Build the transaction that sends all funds to the destination address.
    let transaction = build_p2pkh_spend_tx(
        &own_public_key,
        &own_address,
        &utxos,
        &dst_address,
        fee_per_byte,
    )
    .await?;

    // Sign the transaction.
    let signed_transaction = ecdsa_sign_transaction(
        &own_public_key,
        &own_address,
        transaction,
        CONFIG.ecdsa_key_name.into(),
        derivation_path,
        get_ecdsa_signature,
    )
    .await?;

    let signed_transaction_bytes = serialize(&signed_transaction);

    bitcoin_send_transaction(SendTransactionRequest {
        network: btc_network(),
        transaction: signed_transaction_bytes,
    })
    .await
    .map_err(|err| format!("couldn't submit transaction: {:?}", err))?;

    Ok(signed_transaction.compute_txid())
}

// Get fee percentiles from previous transactions and take the nth percentile.
pub async fn get_fee_per_byte(n: usize) -> Result<Satoshi, String> {
    if n > 99 {
        return Err(format!(
            "percentile should be in the range [0, 99]; got {}",
            n
        ));
    }
    let method = "bitcoin_get_current_fee_percentiles";
    canisters::open_call(method);
    let fee_percentiles = bitcoin_get_current_fee_percentiles(GetCurrentFeePercentilesRequest {
        network: btc_network(),
    })
    .await
    .map_err(|err| format!("fee percentiles could not be fetched: {:?}", err))?
    .0;
    canisters::close_call(method);

    let milli_sat_per_byte = if fee_percentiles.is_empty() {
        // There are no fee percentiles. This case can only happen on a regtest
        // network where there are no non-coinbase transactions. In this case,
        // we use a default of 2000 millisatoshis/byte (i.e. 2 satoshi/byte)
        2000
    } else {
        // Choose the 50th percentile for sending fees.
        fee_percentiles[n]
    };

    Ok(milli_sat_per_byte / 1000)
}

pub async fn get_utxos(address: String) -> Result<Vec<Utxo>, String> {
    let method = "bitcoin_get_utxos";
    canisters::open_call(method);
    // Note that pagination may have to be used to get all UTXOs for the given address.
    // For the sake of simplicity, it is assumed here that the `utxo` field in the response
    // contains all UTXOs.
    let response = bitcoin_get_utxos(GetUtxosRequest {
        address,
        network: btc_network(),
        filter: None,
    })
    .await
    .map_err(|err| format!("failed to get utxos: {:?}", err))?
    .0;
    canisters::close_call(method);

    Ok(response.utxos)
}

// Builds a transaction to send all satoshis to the destination address.
async fn build_p2pkh_spend_tx(
    own_public_key: &[u8],
    own_address: &Address,
    own_utxos: &[Utxo],
    dst_address: &Address,
    fee_per_vbyte: Satoshi,
) -> Result<Transaction, String> {
    // We have a chicken-and-egg problem where we need to know the length
    // of the transaction in order to compute its proper fee, but we need
    // to know the proper fee in order to figure out the inputs needed for
    // the transaction.
    //
    // We solve this problem iteratively. We start with a fee of zero, build
    // and sign a transaction, see what its size is, and then update the fee,
    // rebuild the transaction, until the fee is set to the correct amount.
    async fn mock_signer(
        _key: String,
        _path: Vec<Vec<u8>>,
        _data: Vec<u8>,
    ) -> Result<Vec<u8>, String> {
        Ok(vec![0; 64])
    }

    let mut total_fee = 0;
    loop {
        let (transaction, _prevouts) =
            build_transaction_with_fee(own_utxos, own_address, dst_address, total_fee)?;

        // Sign the transaction. In this case, we only care about the size
        // of the signed transaction, so we use a mock signer here for efficiency.
        let signed_transaction = ecdsa_sign_transaction(
            own_public_key,
            own_address,
            transaction.clone(),
            String::from(""), // mock key name
            vec![],           // mock derivation path
            mock_signer,
        )
        .await?;

        let tx_vsize = signed_transaction.vsize() as u64;

        if (tx_vsize * fee_per_vbyte) == total_fee {
            return Ok(transaction);
        } else {
            total_fee = tx_vsize * fee_per_vbyte;
        }
    }
}

pub fn build_transaction_with_fee(
    own_utxos: &[Utxo],
    own_address: &Address,
    dst_address: &Address,
    fee: u64,
) -> Result<(Transaction, Vec<TxOut>), String> {
    let mut utxos_to_spend = vec![];
    let mut total_spent = 0;
    for utxo in own_utxos.iter() {
        total_spent += utxo.value;
        utxos_to_spend.push(utxo);
    }

    if total_spent < fee {
        return Err(format!(
            "Insufficient balance: trying to transfer {} satoshi with fee {}",
            total_spent, fee
        ));
    }

    let inputs: Vec<TxIn> = utxos_to_spend
        .iter()
        .map(|utxo| TxIn {
            previous_output: OutPoint {
                txid: Txid::from_raw_hash(Hash::from_slice(&utxo.outpoint.txid).unwrap()),
                vout: utxo.outpoint.vout,
            },
            sequence: Sequence::MAX,
            witness: Witness::new(),
            script_sig: ScriptBuf::new(),
        })
        .collect();

    let prevouts = utxos_to_spend
        .into_iter()
        .map(|utxo| TxOut {
            value: Amount::from_sat(utxo.value),
            script_pubkey: own_address.script_pubkey(),
        })
        .collect();

    let remaining_amount = total_spent - fee;

    let outputs = vec![TxOut {
        script_pubkey: dst_address.script_pubkey(),
        value: Amount::from_sat(remaining_amount),
    }];

    Ok((
        Transaction {
            input: inputs,
            output: outputs,
            lock_time: absolute::LockTime::ZERO,
            version: Version(2),
        },
        prevouts,
    ))
}

// Sign a bitcoin transaction.
//
// IMPORTANT: This method only supports signing transactions if:
//
// 1. All the inputs are referencing outpoints that are owned by `own_address`.
// 2. `own_address` is a P2PKH address.
async fn ecdsa_sign_transaction<SignFun, Fut>(
    own_public_key: &[u8],
    own_address: &Address,
    mut transaction: Transaction,
    key_name: String,
    derivation_path: Vec<Vec<u8>>,
    signer: SignFun,
) -> Result<Transaction, String>
where
    SignFun: Fn(String, Vec<Vec<u8>>, Vec<u8>) -> Fut,
    Fut: std::future::Future<Output = Result<Vec<u8>, String>>,
{
    if own_address.address_type() != Some(bitcoin::AddressType::P2pkh) {
        return Err("wrong address type".into());
    }

    let txclone = transaction.clone();
    for (index, input) in transaction.input.iter_mut().enumerate() {
        let sighash = SighashCache::new(&txclone)
            .legacy_signature_hash(
                index,
                &own_address.script_pubkey(),
                EcdsaSighashType::All.to_u32(),
            )
            .map_err(|err| format!("{:?}", err))?;

        let signature = signer(
            key_name.clone(),
            derivation_path.clone(),
            sighash.as_byte_array().to_vec(),
        )
        .await?;

        // Convert signature to DER.
        let der_signature = sec1_to_der(signature);

        let mut sig_with_hashtype: Vec<u8> = der_signature;
        sig_with_hashtype.push(EcdsaSighashType::All.to_u32() as u8);

        let sig_with_hashtype_push_bytes = PushBytesBuf::try_from(sig_with_hashtype).unwrap();
        let own_public_key_push_bytes = PushBytesBuf::try_from(own_public_key.to_vec()).unwrap();
        input.script_sig = Builder::new()
            .push_slice(sig_with_hashtype_push_bytes)
            .push_slice(own_public_key_push_bytes)
            .into_script();
        input.witness.clear();
    }

    Ok(transaction)
}

// Converts a SEC1 ECDSA signature to the DER format.
fn sec1_to_der(sec1_signature: Vec<u8>) -> Vec<u8> {
    let r: Vec<u8> = if sec1_signature[0] & 0x80 != 0 {
        // r is negative. Prepend a zero byte.
        let mut tmp = vec![0x00];
        tmp.extend(sec1_signature[..32].to_vec());
        tmp
    } else {
        // r is positive.
        sec1_signature[..32].to_vec()
    };

    let s: Vec<u8> = if sec1_signature[32] & 0x80 != 0 {
        // s is negative. Prepend a zero byte.
        let mut tmp = vec![0x00];
        tmp.extend(sec1_signature[32..].to_vec());
        tmp
    } else {
        // s is positive.
        sec1_signature[32..].to_vec()
    };

    // Convert signature to DER.
    vec![
        vec![0x30, 4 + r.len() as u8 + s.len() as u8, 0x02, r.len() as u8],
        r,
        vec![0x02, s.len() as u8],
        s,
    ]
    .into_iter()
    .flatten()
    .collect()
}

pub async fn get_ecdsa_signature(
    key_name: String,
    derivation_path: Vec<Vec<u8>>,
    message_hash: Vec<u8>,
) -> Result<Vec<u8>, String> {
    let key_id = EcdsaKeyId {
        curve: EcdsaCurve::Secp256k1,
        name: key_name,
    };

    let res: (SignWithEcdsaResponse,) = canisters::call_canister_with_payment(
        Principal::management_canister(),
        "sign_with_ecdsa",
        (SignWithEcdsaArgument {
            message_hash,
            derivation_path,
            key_id,
        },),
        26_153_846_153,
    )
    .await
    .map_err(|err| format!("call failed: {:?}", err))?;

    Ok(res.0.signature)
}
