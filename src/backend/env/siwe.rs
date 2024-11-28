use crate::{time, SESSIONS};
use candid::Principal;
use ic_cdk::api::management_canister::main::raw_rand;
use ic_siwe::eth::{recover_eth_address, EthSignature};
use serde::Serialize;
use std::collections::HashMap;

use super::{config::CONFIG, Time, HOUR};

type Delegate = Principal;
type Nonce = String;

/// Session is valid if a message containing the `nonce` was signed by `delegator`.
/// In this case, it's `active` flag is set to true.
/// If such a session exists, all query and update calls signed by the delegate pointing to an
/// active session, will be executed for the delegator.
#[derive(Clone, Serialize)]
pub struct Session {
    pub nonce: String,
    timestamp: u64,
    /// Ethereum address bytes.
    delegator: Principal,
    /// Indicates whether a signature was verified.
    active: bool,
}

impl Session {
    pub fn expired(&self, now: Time) -> bool {
        self.timestamp + 8 * HOUR < now
    }
}

/// A simple mapping from delegate to a session.
pub type SIWESessions = HashMap<Delegate, Session>;

/// Opens a new session for delegator and it's delegate and returns the nonce,
/// or returns the nonce of an already existing session.
pub async fn new_session(delegator: Principal, delegate: Delegate) -> Nonce {
    if let Some(existing_session) = SESSIONS.with_borrow(|cell| cell.get(&delegate).cloned()) {
        return existing_session.nonce;
    }
    let (randomness,) = raw_rand().await.expect("no randomness");
    use std::convert::TryInto;
    let bytes: [u8; 32] = randomness[0..32]
        .try_into()
        .expect("couldn't convert bytes to array");
    let nonce = hex::encode(bytes);
    let session = Session {
        nonce: nonce.clone(),
        timestamp: time(),
        delegator,
        active: false,
    };
    SESSIONS.with_borrow_mut(|cell| cell.insert(delegate, session));
    nonce
}

/// Returns the delegator if an active session exists.
pub fn get_delegator_for(delegate: &Delegate) -> Option<Principal> {
    SESSIONS.with_borrow(|cell| {
        let session = cell.get(delegate)?;
        if !session.active {
            return None;
        };
        Some(session.delegator)
    })
}

/// Verifies the message signed by the delegator.
/// If the signature can be confirmed, the session is marked as active.
pub fn confirm_session(
    delegate: Delegate,
    message: String,
    signature: String,
) -> Result<(), String> {
    SESSIONS.with_borrow_mut(|cell| {
        let session = cell.get_mut(&delegate).ok_or("no session found")?;
        let expected_address =
            format!("0x{}", &hex::encode(session.delegator.as_slice())[2..]).to_lowercase();

        // The signed message should contain the expected statement, the nonce and the delegator
        // address. Note, we don't need to check timestamps because we check against fresh nonces.
        if !message.contains(CONFIG.siwe_statement)
            || !message.to_lowercase().contains(&expected_address)
            || !message.contains(&session.nonce)
        {
            return Err("invalid message".into());
        }

        let sig = EthSignature::new(&signature).map_err(|_| "signature parsing failed")?;
        // Recover the public key of the ECDSA signature.
        let address = recover_eth_address(&message, &sig)
            .map_err(|err| format!("verification failed: {:?}", err))?
            .to_lowercase();

        if address == expected_address {
            session.active = true;
            return Ok(());
        }

        Err("invalid signature".into())
    })
}
