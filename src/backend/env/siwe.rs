use crate::{time, SESSIONS};
use candid::Principal;
use ic_siwe::eth::{recover_eth_address, EthSignature};
use serde::Serialize;
use std::collections::HashMap;
use time::{format_description::well_known::Iso8601, macros::offset, PrimitiveDateTime};

use super::{config::CONFIG, Time, HOUR, MINUTE};

type Delegate = Principal;

/// Session is valid if a message containing the `nonce` was signed by `delegator`.
/// If such a session exists, all query and update calls signed by the delegate pointing to an
/// active session, will be executed on behalf of the delegator.
#[derive(Clone, Serialize)]
pub struct Session {
    pub nonce: String,
    timestamp: u64,
    /// Principal created from Ethereum address bytes.
    delegator: Principal,
}

impl Session {
    pub fn expired(&self, now: Time) -> bool {
        self.timestamp + 8 * HOUR < now
    }
}

/// A simple mapping from delegate to a session.
pub type SIWESessions = HashMap<Delegate, Session>;

/// Returns the delegator if an active session exists.
pub fn get_delegator_for(delegate: &Delegate) -> Option<Principal> {
    SESSIONS.with_borrow(|cell| cell.get(delegate).map(|session| session.delegator))
}

/// Opens a new session for delegator and it's delegate and returns the nonce.
pub fn create_session(
    delegate: Delegate,
    message: String,
    signature: String,
) -> Result<Principal, String> {
    let issued_at = get_timestamp(&message).ok_or("no timestamp")?;

    if issued_at + MINUTE < time() || time() + MINUTE < issued_at {
        return Err("signature has expired of too far in the future".into());
    }

    let sig = EthSignature::new(&signature)
        .map_err(|err| format!("signature parsing failed: {}", err))?;
    // Recover the public key of the ECDSA signature.
    let address = recover_eth_address(&message, &sig)
        .map_err(|err| format!("address recovery failed: {:?}", err))?
        .to_lowercase();
    let nonce = delegate.to_text().replace('-', "");

    // The signed message should contain the expected statement, the nonce and the delegator
    // address. Note, we don't need to check timestamps because we check against fresh nonces.
    let message = message.to_lowercase();
    if !message.contains(&CONFIG.siwe_statement.to_lowercase()) {
        return Err("wrong statement".into());
    }
    if !message.contains(&nonce) {
        return Err("nonce missing".into());
    }
    if !message.contains(&address) {
        return Err("delegator missing".into());
    }

    let delegator =
        Principal::from_slice(&hex::decode(&address[2..]).expect("couldn't decode address"));

    SESSIONS.with_borrow_mut(|cell| {
        cell.insert(
            delegate,
            Session {
                nonce,
                timestamp: time(),
                delegator,
            },
        );
    });

    Ok(delegator)
}

// Extracts the "Issued At" timestamp from the message.
fn get_timestamp(message: &str) -> Option<u64> {
    let timestamp = message
        .lines()
        .find(|line| line.starts_with("Issued At:"))
        .and_then(|line| line.strip_prefix("Issued At: "))?;

    PrimitiveDateTime::parse(timestamp, &Iso8601::DEFAULT)
        .ok()
        .map(|time| time.assume_offset(offset!(UTC)).unix_timestamp_nanos() as u64)
}
