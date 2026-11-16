use super::{
    canisters,
    config::{CONFIG, ICP_CYCLES_PER_XDR},
    token::{self, Token},
    user::{CreditsDelta, UserId},
    Credits, State,
};
use crate::{mutate, read};
use candid::Principal;
use ic_cdk_management_canister::{
    EcdsaCurve, EcdsaKeyId, EcdsaPublicKeyArgs, EcdsaPublicKeyResult, SignWithEcdsaArgs,
    SignWithEcdsaResult,
};
use k256::{
    ecdsa::{RecoveryId, Signature, VerifyingKey},
    elliptic_curve::sec1::ToEncodedPoint,
    PublicKey,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::convert::TryInto;
use tiny_keccak::{Hasher, Keccak};

pub const DERIVATION_PATH: &[u8] = b"ethereum";

/// 1 IC base unit (0.01 TAGGR) is worth 1e16 wei.
pub const WEI_PER_BASE_UNIT: u128 = 10_000_000_000_000_000;

const DOMAIN_NAME: &str = "TAGGR";
const DOMAIN_VERSION: &str = "1";

#[derive(Default, Clone, Serialize, Deserialize)]
#[serde(default)] // keep old state readable when fields are added
pub struct EthBridge {
    pub next_index: u64,
    pub bridged_out: Token,
    /// Cached ECDSA signing cost in credits, refreshed by the weekly chores.
    pub signing_fee_credits: Credits,
    pub recipes: BTreeMap<u64, EthMintRecipe>,
}

#[derive(Default, Clone, Serialize, Deserialize)]
#[serde(default)] // keep stored recipes readable when fields are added
pub struct EthMintRecipe {
    pub index: u64,
    pub user_id: UserId,
    pub eth_address: String,
    pub amount: Token,
    pub burn_block: u64,
    pub signature: Vec<u8>,
}

#[derive(Serialize)]
pub struct EthConfig {
    pub token_address: String,
    pub chain_id: u64,
    pub fee_credits: Credits,
    pub min_amount: Token,
}

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

/// Returns the deployed token address, or an error while it is not configured.
pub fn token_address() -> Result<[u8; 20], String> {
    let configured = CONFIG.eth_token_address.trim();
    if configured.is_empty() {
        return Err("the Ethereum token address is not configured".into());
    }
    let address = parse_address(configured)?;
    if address == [0u8; 20] {
        return Err("the Ethereum token address is not configured".into());
    }
    Ok(address)
}

pub fn parse_address(address: &str) -> Result<[u8; 20], String> {
    let address = address
        .strip_prefix("0x")
        .or_else(|| address.strip_prefix("0X"))
        .unwrap_or(address);
    if address.len() != 40 {
        return Err(format!("invalid Ethereum address: {}", address));
    }
    let bytes =
        hex::decode(address).map_err(|_| format!("invalid Ethereum address: {}", address))?;
    bytes
        .try_into()
        .map_err(|_| format!("invalid Ethereum address: {}", address))
}

/// The EIP-712 digest that the minter signs for `mintWithAuthorization`.
pub fn mint_digest(token: [u8; 20], to: [u8; 20], amount: Token, index: u64) -> [u8; 32] {
    let domain_typehash = keccak256(
        b"EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)",
    );
    let mint_typehash = keccak256(b"Mint(address to,uint256 amount,uint256 index)");

    let mut domain_preimage = [0u8; 5 * 32];
    domain_preimage[0..32].copy_from_slice(&domain_typehash);
    domain_preimage[32..64].copy_from_slice(&keccak256(DOMAIN_NAME.as_bytes()));
    domain_preimage[64..96].copy_from_slice(&keccak256(DOMAIN_VERSION.as_bytes()));
    domain_preimage[96..128].copy_from_slice(&uint256_word(CONFIG.eth_chain_id as u128));
    domain_preimage[128..160].copy_from_slice(&address_word(token));
    let domain_separator = keccak256(&domain_preimage);

    let mut struct_preimage = [0u8; 4 * 32];
    struct_preimage[0..32].copy_from_slice(&mint_typehash);
    struct_preimage[32..64].copy_from_slice(&address_word(to));
    struct_preimage[64..96].copy_from_slice(&uint256_word(amount as u128 * WEI_PER_BASE_UNIT));
    struct_preimage[96..128].copy_from_slice(&uint256_word(index as u128));
    let struct_hash = keccak256(&struct_preimage);

    let mut preimage = [0u8; 2 + 32 + 32];
    preimage[0] = 0x19;
    preimage[1] = 0x01;
    preimage[2..34].copy_from_slice(&domain_separator);
    preimage[34..66].copy_from_slice(&struct_hash);
    keccak256(&preimage)
}

/// The cycles required to sign one message with the configured ECDSA key.
pub fn sign_cost() -> Result<u128, String> {
    ic_cdk::api::cost_sign_with_ecdsa(CONFIG.ecdsa_key_name, EcdsaCurve::Secp256k1 as u32)
        .map_err(|err| format!("couldn't compute the ECDSA signing cost: {}", err))
}

/// Converts a cycle cost into credits, rounding up.
pub fn sign_fee_credits(cycles: u128) -> Credits {
    let per_xdr = CONFIG.credits_per_xdr as u128;
    let cycles_per_xdr = ICP_CYCLES_PER_XDR as u128;
    (cycles * per_xdr).div_ceil(cycles_per_xdr) as Credits
}

/// Why `sign_digest` returned no usable signature.
pub enum SignError {
    /// The call failed without a response, so no signature exists.
    NotSigned(String),
    /// A response arrived but could not be used. It may still carry a valid
    /// signature, and every replica serving the call has seen it.
    Unusable(String),
}

pub async fn sign_digest(digest: &[u8; 32], cycles: u128) -> Result<Vec<u8>, SignError> {
    let args = SignWithEcdsaArgs {
        message_hash: digest.to_vec(),
        derivation_path: vec![DERIVATION_PATH.to_vec()],
        key_id: EcdsaKeyId {
            curve: EcdsaCurve::Secp256k1,
            name: CONFIG.ecdsa_key_name.into(),
        },
    };

    let (result,): (SignWithEcdsaResult,) = canisters::call_canister_with_payment(
        Principal::management_canister(),
        "sign_with_ecdsa",
        (args,),
        cycles,
    )
    .await
    .map_err(|err| {
        let message = format!("sign_with_ecdsa call failed: {:?}", err);
        match err {
            ic_cdk::call::Error::CandidDecodeFailed(_) => SignError::Unusable(message),
            _ => SignError::NotSigned(message),
        }
    })?;

    let public_key = read(|state| state.eth_public_key.clone());
    normalize_signature(&result.signature, digest, &public_key).map_err(SignError::Unusable)
}

/// Normalizes the canister signature to a 65-byte low-s `r || s || v` with
/// `v` in `{27, 28}`, picking the recovery id that matches the cached key.
pub fn normalize_signature(
    signature: &[u8],
    digest: &[u8; 32],
    public_key: &[u8],
) -> Result<Vec<u8>, String> {
    if signature.len() != 64 {
        return Err(format!(
            "unexpected ECDSA signature length: {}",
            signature.len()
        ));
    }

    let mut signature = Signature::from_slice(signature)
        .map_err(|err| format!("invalid ECDSA signature: {:?}", err))?;
    if let Some(normalized) = signature.normalize_s() {
        signature = normalized;
    }

    let expected = PublicKey::from_sec1_bytes(public_key)
        .map_err(|err| format!("invalid cached ECDSA public key: {:?}", err))?
        .to_encoded_point(false);

    for id in 0u8..=1 {
        let recovery_id = RecoveryId::from_byte(id).ok_or("invalid recovery id")?;
        if let Ok(key) = VerifyingKey::recover_from_prehash(digest, &signature, recovery_id) {
            if key.to_encoded_point(false).as_bytes() == expected.as_bytes() {
                let mut bytes = signature.to_bytes().to_vec();
                bytes.push(27 + id);
                return Ok(bytes);
            }
        }
    }

    Err("signature does not match the canister's Ethereum key".into())
}

impl State {
    /// Refreshes the cached ECDSA signing cost that `eth_config` reports.
    pub fn refresh_signing_fee(&mut self) {
        #[cfg(not(test))]
        if let Ok(cost) = sign_cost() {
            // Keep the previous value when the lookup fails: a zero fee would
            // silently make signing free.
            self.eth_bridge.signing_fee_credits = sign_fee_credits(cost);
        }
    }
}

pub fn eth_config() -> EthConfig {
    EthConfig {
        token_address: CONFIG.eth_token_address.to_string(),
        chain_id: CONFIG.eth_chain_id,
        fee_credits: read(|state| state.eth_bridge.signing_fee_credits),
        min_amount: token::base(),
    }
}

impl State {
    /// Checks everything that can be checked before anything is signed or
    /// charged and resolves the user the recipe belongs to.
    fn bridge_out_precheck(&self, caller: Principal, amount: Token) -> Result<UserId, String> {
        if amount < token::base() {
            return Err(format!(
                "the minimum bridging amount is 1 {}",
                CONFIG.token_symbol
            ));
        }
        if self.eth_public_key.is_empty() {
            return Err("the canister's Ethereum key is not ready yet".to_string());
        }
        // Cold wallets are refused: `link_cold_wallet` is one-sided (any
        // unregistered principal can claim a user that has no cold wallet yet),
        // so resolving the caller through `cold_wallets` would let a stranger
        // bridge at the linked user's expense. Lift this once linking needs the
        // user's approval (see docs/ETHEREUM.md).
        if self.cold_wallets.contains_key(&caller) {
            return Err("bridging from a cold wallet is disabled".to_string());
        }
        let user_id = self.principal_to_user(caller).ok_or("user not found")?.id;
        if self.voted_on_emergency_proposal(caller) {
            return Err(
                "transfers are locked while a vote on a pending emergency proposal is registered"
                    .to_string(),
            );
        }
        // An open proposal locks tokens, so bridging is refused outright instead
        // of working with the remaining balance.
        if self.open_proposals(user_id).next().is_some() {
            return Err("bridging is disabled while you have an open proposal".to_string());
        }
        let balance = self
            .balances
            .get(&token::account(caller))
            .copied()
            .unwrap_or_default();
        if balance < amount {
            return Err("not enough tokens".to_string());
        }
        Ok(user_id)
    }

    /// Burns the tokens a recipe will mint on L1 and books them as bridged. Runs
    /// before the canister signs, so a signature can never exist for tokens that
    /// are still on the IC.
    fn burn_for_bridge(&mut self, caller: Principal, amount: Token) -> Result<u64, String> {
        let burn_block = token::burn(self, caller, amount, "Bridging to Ethereum")
            .map_err(|err| format!("couldn't burn tokens: {:?}", err))?;
        self.eth_bridge.bridged_out = self
            .eth_bridge
            .bridged_out
            .checked_add(amount)
            .ok_or("bridged supply overflow")?;
        Ok(burn_block as u64)
    }

    /// Undoes [`State::burn_for_bridge`] when no signature could be produced, so
    /// a failed signing costs the fee and an index but not the tokens.
    fn refund_bridge(&mut self, caller: Principal, amount: Token) -> Result<(), String> {
        // Drop the bridged bookkeeping first: the burn moved the tokens from the
        // balances into `bridged_out`, so subtracting here restores the supply
        // the cap check sees to what it was before the bridge.
        self.eth_bridge.bridged_out = self.eth_bridge.bridged_out.saturating_sub(amount);
        self.minting_mode = true;
        let refunded = token::mint(self, token::account(caller), amount, "Bridge refund");
        self.minting_mode = false;
        match refunded {
            Ok(_) => Ok(()),
            // Minting failed: keep the books as they were, so the burned tokens
            // are still accounted and can be retried or refunded later.
            Err(err) => {
                self.eth_bridge.bridged_out = self.eth_bridge.bridged_out.saturating_add(amount);
                Err(err)
            }
        }
    }

    /// Burns `amount` IC tokens and stores an EIP-712 mint recipe for the L1
    /// token. The burn and the fee come first, so a signature is only ever
    /// produced for tokens that have already left the IC; a rejected signing
    /// call refunds the burn but keeps the fee, which paid for the attempt,
    /// while an unusable response keeps the burn, as it may carry a signature. The index
    /// is reserved before signing and is never reused, including after a failure.
    pub async fn bridge_out(
        caller: Principal,
        amount: Token,
        eth_address: String,
    ) -> Result<EthMintRecipe, String> {
        let to = parse_address(&eth_address)?;
        let token = token_address()?;
        let cycles = sign_cost()?;
        let fee = sign_fee_credits(cycles);
        if fee == 0 {
            return Err("couldn't compute the signing fee".to_string());
        }

        let (index, user_id, digest, burn_block) =
            mutate(|state| -> Result<(u64, UserId, [u8; 32], u64), String> {
                let user_id = state.bridge_out_precheck(caller, amount)?;
                // Deliberately not `State::charge`: the fee only recovers the
                // cycles burned by `sign_with_ecdsa`, so booking it as revenue
                // would distribute ICP the canister also pays for the signature.
                state
                    .users
                    .get_mut(&user_id)
                    .ok_or("user not found")?
                    .change_credits(fee, CreditsDelta::Minus, "Bridging to Ethereum")?;
                // Burn before signing: a `sign_with_ecdsa` response is visible to
                // every replica that serves the call, so a signature produced
                // for a burn that then failed would let a single subnet node
                // mint on L1 without a matching burn.
                let burn_block = state.burn_for_bridge(caller, amount)?;
                let index = state.eth_bridge.next_index;
                state.eth_bridge.next_index =
                    index.checked_add(1).ok_or("recipe index overflow")?;
                Ok((
                    index,
                    user_id,
                    mint_digest(token, to, amount, index),
                    burn_block,
                ))
            })?;

        let signature = match sign_digest(&digest, cycles).await {
            Ok(signature) => signature,
            Err(SignError::Unusable(err)) => {
                // No refund: the response may hold a valid signature that any
                // replica could relay to L1, so the burn must stay.
                mutate(|state| {
                    state.logger.critical(format!(
                        "Recipe #{} has no usable signature; `{}` {} stay burned: {}",
                        index,
                        amount / token::base(),
                        CONFIG.token_symbol,
                        err
                    ))
                });
                return Err(err);
            }
            Err(SignError::NotSigned(err)) => {
                // The fee stays: it pays for the signature attempt, and the call
                // itself may have burned the cycles before failing.
                mutate(|state| {
                    if let Err(refund) = state.refund_bridge(caller, amount) {
                        state.logger.critical(format!(
                            "Couldn't refund `{}` {} after a failed signing: {}",
                            amount / token::base(),
                            CONFIG.token_symbol,
                            refund
                        ));
                    }
                });
                return Err(err);
            }
        };

        // Cannot fail: the burn is already in the ledger and the index reserved.
        Ok(mutate(|state| {
            let recipe = EthMintRecipe {
                index,
                user_id,
                eth_address: format!("0x{}", hex::encode(to)),
                amount,
                burn_block,
                signature,
            };
            state.eth_bridge.recipes.insert(index, recipe.clone());
            state.logger.info(format!(
                "Ethereum bridge recipe #{} issued for `{}` {}",
                index,
                amount / token::base(),
                CONFIG.token_symbol
            ));
            recipe
        }))
    }
}

fn keccak256(data: &[u8]) -> [u8; 32] {
    let mut hasher = Keccak::v256();
    hasher.update(data);
    let mut output = [0u8; 32];
    hasher.finalize(&mut output);
    output
}

fn uint256_word(value: u128) -> [u8; 32] {
    let mut word = [0u8; 32];
    word[16..].copy_from_slice(&value.to_be_bytes());
    word
}

fn address_word(address: [u8; 20]) -> [u8; 32] {
    let mut word = [0u8; 32];
    word[12..].copy_from_slice(&address);
    word
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
    use k256::ecdsa::SigningKey;

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

    #[test]
    fn parses_addresses() {
        assert_eq!(
            parse_address("0x5FbDB2315678afecb367f032d93F642f64180aa3").unwrap(),
            [
                0x5f, 0xbd, 0xb2, 0x31, 0x56, 0x78, 0xaf, 0xec, 0xb3, 0x67, 0xf0, 0x32, 0xd9, 0x3f,
                0x64, 0x2f, 0x64, 0x18, 0x0a, 0xa3
            ]
        );
        assert!(parse_address("").is_err());
        assert!(parse_address("0x1234").is_err());
        assert!(parse_address("0xZZBDB2315678afecb367f032d93F642f64180aa3").is_err());
    }

    #[test]
    fn digest_matches_reference_vector() {
        let token = parse_address("0x5FbDB2315678afecb367f032d93F642f64180aa3").unwrap();
        let to = parse_address("0x000000000000000000000000000000000000dEaD").unwrap();
        let digest = mint_digest(token, to, 1, 7);
        assert_eq!(
            hex::encode(digest),
            "3de93b91200d126933461542fecdeab280c7509396de2f52e6ce116213409397"
        );
    }

    #[test]
    fn normalizes_signature_and_recovers_v() {
        let signing_key = SigningKey::from_bytes(&[7u8; 32].into()).unwrap();
        let digest = [9u8; 32];
        let (signature, _) = signing_key.sign_prehash_recoverable(&digest).unwrap();
        let public_key = signing_key.verifying_key().to_encoded_point(false);

        let normalized =
            normalize_signature(&signature.to_bytes(), &digest, public_key.as_bytes()).unwrap();
        assert_eq!(normalized.len(), 65);
        assert!(normalized[64] == 27 || normalized[64] == 28);
        assert!(normalized[32..64]
            .iter()
            .zip(signature.to_bytes()[32..64].iter())
            .all(|(a, b)| a == b));
    }

    #[test]
    fn rejects_signature_from_another_key() {
        let signing_key = SigningKey::from_bytes(&[7u8; 32].into()).unwrap();
        let other = SigningKey::from_bytes(&[8u8; 32].into()).unwrap();
        let digest = [9u8; 32];
        let (signature, _) = signing_key.sign_prehash_recoverable(&digest).unwrap();
        let other_public_key = other.verifying_key().to_encoded_point(false);
        assert!(
            normalize_signature(&signature.to_bytes(), &digest, other_public_key.as_bytes())
                .is_err()
        );
    }

    #[test]
    fn bridge_precheck_validates_the_caller_and_the_balance() {
        use crate::env::tests::{create_user, insert_balance, pr};

        mutate(|state| {
            state.init();
            create_user(state, pr(1));
            insert_balance(state, pr(1), 1000);

            assert_eq!(
                state.bridge_out_precheck(pr(1), 100).unwrap_err(),
                "the canister's Ethereum key is not ready yet"
            );

            state.eth_public_key = vec![2; 33];

            assert_eq!(
                state.bridge_out_precheck(pr(2), 100).unwrap_err(),
                "user not found"
            );
            assert_eq!(
                state.bridge_out_precheck(pr(1), 1001).unwrap_err(),
                "not enough tokens"
            );
            assert!(state.bridge_out_precheck(pr(1), 1000).is_ok());

            state.emergency_votes.insert(pr(1), 1);
            assert_eq!(
                state.bridge_out_precheck(pr(1), 100).unwrap_err(),
                "transfers are locked while a vote on a pending emergency proposal is registered"
            );
            state.emergency_votes.clear();

            // Cold wallets cannot bridge: linking one is a one-sided claim, so a
            // stranger could otherwise spend the linked user's credits.
            let user_id = create_user(state, pr(3));
            state.cold_wallets.insert(pr(200), user_id);
            insert_balance(state, pr(200), 500);
            assert_eq!(
                state.bridge_out_precheck(pr(200), 500),
                Err("bridging from a cold wallet is disabled".to_string())
            );

            // An open proposal locks tokens, so bridging is refused.
            let proposer = state.principal_to_user(pr(1)).unwrap().id;
            state.proposals.push(crate::env::proposals::Proposal {
                proposer,
                status: crate::env::proposals::Status::Open,
                escrow_tokens: token::base(),
                ..Default::default()
            });
            assert_eq!(
                state.bridge_out_precheck(pr(1), 100).unwrap_err(),
                "bridging is disabled while you have an open proposal"
            );

            // The minimum is part of the pre-check.
            state.proposals.clear();
            assert_eq!(
                state
                    .bridge_out_precheck(pr(1), token::base() - 1)
                    .unwrap_err(),
                "the minimum bridging amount is 1 TAGGR"
            );
        });
    }

    #[test]
    fn signing_fee_is_charged_off_the_revenue_ledger() {
        use crate::env::tests::{create_user_with_credits, pr};

        let (user_id, revenue) = mutate(|state| {
            state.init();
            let user_id = create_user_with_credits(state, pr(1), 100);
            (user_id, state.burned_cycles)
        });

        // Same call as in `bridge_out`.
        mutate(|state| {
            state
                .users
                .get_mut(&user_id)
                .unwrap()
                .change_credits(30, CreditsDelta::Minus, "Bridging to Ethereum")
                .unwrap()
        });
        assert_eq!(read(|state| state.users[&user_id].credits()), 70);
        // Cost recovery, not revenue.
        assert_eq!(read(|state| state.burned_cycles), revenue);
    }

    #[test]
    fn converts_signing_cost_to_credits() {
        assert_eq!(sign_fee_credits(10_000_000_000), 10);
        assert_eq!(sign_fee_credits(0), 0);
        assert_eq!(sign_fee_credits(1), 1);
    }

    #[test]
    fn a_failed_signing_refunds_the_burn() {
        use crate::env::tests::{create_user, insert_balance, pr};

        mutate(|state| {
            state.init();
            create_user(state, pr(1));
            insert_balance(state, pr(1), 10 * token::base());
            let account = token::account(pr(1));
            let balance = state.balances[&account];
            let supply = state.total_supply();
            let ledger = state.memory.ledger.len();

            // The burn leaves the combined supply untouched: the tokens only
            // move from the IC balances into `bridged_out`.
            let burn_block = state.burn_for_bridge(pr(1), 3 * token::base()).unwrap();
            assert_eq!(burn_block as usize, ledger);
            assert_eq!(state.balances[&account], balance - 3 * token::base());
            assert_eq!(state.eth_bridge.bridged_out, 3 * token::base());
            assert_eq!(state.total_supply(), supply);

            state.refund_bridge(pr(1), 3 * token::base()).unwrap();
            assert_eq!(state.balances[&account], balance);
            assert_eq!(state.eth_bridge.bridged_out, 0);
            assert_eq!(state.total_supply(), supply);

            // A refund works even with the whole supply accounted for: it hands
            // back exactly what the burn took, and the cap check sees the supply
            // as it stood before the bridge.
            state.eth_bridge.bridged_out = CONFIG.maximum_supply - state.circulating_supply();
            assert_eq!(state.remaining_supply(), 0);
            state.burn_for_bridge(pr(1), token::base()).unwrap();
            assert_eq!(state.remaining_supply(), 0);
            state.refund_bridge(pr(1), token::base()).unwrap();
            assert_eq!(state.remaining_supply(), 0);
            assert_eq!(state.balances[&account], balance);
        });
    }
}
