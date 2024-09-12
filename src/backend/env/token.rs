use super::MINUTE;
use crate::*;
use assets::{add_value_to_certify, certify, root_hash};
use base64::{engine::general_purpose, Engine as _};
use candid::{CandidType, Deserialize, Principal};
use ic_cdk_macros::{query, update};
use ic_certified_map::leaf_hash;
use ic_ledger_types::GetBlocksArgs;
use icrc_ledger_types::{
    icrc::generic_value::ICRC3Value,
    icrc3::{
        archive::{GetArchivesArgs, GetArchivesResult},
        blocks::{
            BlockWithId, GetBlocksResult, ICRC3DataCertificate, ICRC3GenericBlock,
            SupportedBlockType,
        },
    },
};
use serde::Serialize;
use serde_bytes::ByteBuf;

type Timestamp = u64;

pub type Subaccount = Vec<u8>;

type Memo = Vec<u8>;

pub type Token = u64;

#[derive(CandidType, Clone, Serialize, Deserialize, Hash, Eq, PartialEq)]
pub struct Account {
    pub owner: Principal,
    pub subaccount: Option<Subaccount>,
}

#[derive(CandidType, Deserialize)]
pub struct TransferArgs {
    pub from_subaccount: Option<Subaccount>,
    pub to: Account,
    pub amount: u128,
    pub fee: Option<u128>,
    pub memo: Option<Memo>,
    pub created_at_time: Option<Timestamp>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Transaction {
    pub timestamp: u64,
    pub from: Account,
    pub to: Account,
    pub amount: Token,
    pub fee: Token,
    pub memo: Option<Memo>,
    #[serde(default)]
    pub parent_hash: [u8; 32],
    #[serde(default)]
    pub id: u32,
}

#[cfg_attr(test, derive(PartialEq))]
#[derive(CandidType, Debug, Serialize, Deserialize)]
pub struct BadFee {
    expected_fee: u128,
}

// pub struct BadBurn {
//     min_burn_amount: u64,
// }

// pub struct Duplicate {
//     duplicate_of: u64,
// }

#[cfg_attr(test, derive(PartialEq))]
#[derive(CandidType, Debug, Serialize, Deserialize)]
pub struct InsufficientFunds {
    balance: u128,
}

#[cfg_attr(test, derive(PartialEq))]
#[derive(CandidType, Debug, Serialize, Deserialize)]
pub struct CreatedInFuture {
    ledger_time: Timestamp,
}

#[cfg_attr(test, derive(PartialEq))]
#[derive(CandidType, Debug, Serialize, Deserialize)]
pub struct GenericError {
    error_code: u128,
    message: String,
}

#[cfg_attr(test, derive(PartialEq))]
#[derive(CandidType, Debug, Serialize, Deserialize)]
pub enum TransferError {
    BadFee(BadFee),
    // BadBurn(BadBurn),
    // Duplicate(Duplicate),
    // TemporarilyUnavailable,
    InsufficientFunds(InsufficientFunds),
    TooOld,
    CreatedInFuture(CreatedInFuture),
    GenericError(GenericError),
}

#[derive(CandidType)]
pub enum Value {
    Nat(u128),
    Text(String),
    // Int(i64),
    // Blob(Vec<u8>),
}

#[derive(CandidType)]
pub struct Standard {
    name: String,
    url: String,
}

#[query]
fn icrc1_metadata() -> Vec<(String, Value)> {
    vec![
        ("icrc1:symbol".into(), Value::Text(icrc1_symbol())),
        ("icrc1:name".into(), Value::Text(icrc1_name())),
        (
            "icrc1:decimals".into(),
            Value::Nat(icrc1_decimals() as u128),
        ),
        ("icrc1:fee".into(), Value::Nat(icrc1_fee())),
        (
            "icrc1:logo".into(),
            Value::Text(format!(
                "data:image/png;base64,{}",
                general_purpose::STANDARD
                    .encode(include_bytes!("../../frontend/assets/apple-touch-icon.png"))
            )),
        ),
    ]
}

#[query]
fn icrc1_name() -> String {
    CONFIG.name.into()
}

#[query]
fn icrc1_symbol() -> String {
    CONFIG.token_symbol.into()
}

#[query]
fn icrc1_decimals() -> u8 {
    CONFIG.token_decimals
}

#[query]
pub fn icrc1_fee() -> u128 {
    CONFIG.transaction_fee as u128
}

#[query]
pub fn icrc1_total_supply() -> u128 {
    read(|state| state.balances.values().copied().sum::<u64>() as u128)
}

#[query]
fn icrc1_minting_account() -> Option<Account> {
    Some(account(Principal::anonymous()))
}

#[query]
fn icrc1_balance_of(mut account: Account) -> u128 {
    if account
        .subaccount
        .as_ref()
        .map(|val| val.iter().all(|b| b == &0))
        .unwrap_or(true)
    {
        account.subaccount = None
    };
    read(|state| state.balances.get(&account).copied().unwrap_or_default() as u128)
}

#[query]
fn icrc1_supported_standards() -> Vec<Standard> {
    vec![
        Standard {
            name: "ICRC-1".into(),
            url: "https://github.com/dfinity/ICRC-1/tree/main/standards/ICRC-1".into(),
        },
        Standard {
            name: "ICRC-3".into(),
            url: "https://github.com/dfinity/ICRC-1/tree/main/standards/ICRC-3".into(),
        },
    ]
}

#[update]
fn icrc1_transfer(mut args: TransferArgs) -> Result<u128, TransferError> {
    let owner = caller();
    if owner == Principal::anonymous() {
        return Err(TransferError::GenericError(GenericError {
            error_code: 0,
            message: "No transfers from the minting account possible.".into(),
        }));
    }
    if args.fee.is_none() {
        args.fee = Some(icrc1_fee())
    } else if args.fee != Some(icrc1_fee()) {
        return Err(TransferError::BadFee(BadFee {
            expected_fee: icrc1_fee(),
        }));
    }
    mutate(|state| transfer(state, time(), owner, args))
}

#[query]
fn icrc3_get_blocks(args: Vec<GetBlocksArgs>) -> GetBlocksResult {
    let mut blocks: Vec<BlockWithId> = Default::default();
    read(|state| {
        for arg in args {
            for i in arg.start..(arg.start + arg.length) {
                if let Some(tx) = state.memory.ledger.get(&(i as u32)) {
                    blocks.push(tx.into());
                }
            }
        }
    });
    GetBlocksResult {
        log_length: blocks.len().into(),
        blocks,
        archived_blocks: Default::default(),
    }
}

#[query]
fn icrc3_get_archives(_: GetArchivesArgs) -> GetArchivesResult {
    Default::default()
}

#[query]
fn icrc3_supported_block_types() -> Vec<SupportedBlockType> {
    vec![
        SupportedBlockType {
            block_type: "1mint".to_string(),
            url: "https://github.com/dfinity/ICRC-1/blob/main/standards/ICRC-1/README.md"
                .to_string(),
        },
        SupportedBlockType {
            block_type: "1burn".to_string(),
            url: "https://github.com/dfinity/ICRC-1/blob/main/standards/ICRC-1/README.md"
                .to_string(),
        },
        SupportedBlockType {
            block_type: "1xfer".to_string(),
            url: "https://github.com/dfinity/ICRC-1/blob/main/standards/ICRC-1/README.md"
                .to_string(),
        },
    ]
}

#[query]
fn icrc3_get_tip_certificate() -> Option<ICRC3DataCertificate> {
    let certificate = ByteBuf::from(ic_cdk::api::data_certificate()?);
    let hash_tree = root_hash();
    let tree_buf = serde_cbor::to_vec(&hash_tree).expect("couldn't serialize");
    Some(ICRC3DataCertificate {
        certificate,
        hash_tree: ByteBuf::from(tree_buf),
    })
}

impl Into<BlockWithId> for Transaction {
    fn into(self) -> BlockWithId {
        let btype = if self.from.owner == Principal::anonymous() {
            "1mint"
        } else if self.to.owner == Principal::anonymous() {
            "1burn"
        } else {
            "1xfer"
        }
        .to_string();

        let tx_data = vec![
            ("amt".into(), ICRC3Value::Nat(self.amount.into())),
            (
                "from".into(),
                ICRC3Value::Array(vec![ICRC3Value::Blob(ByteBuf::from(
                    serde_cbor::to_vec(&self.from).expect("couldn't serialize"),
                ))]),
            ),
            (
                "to".into(),
                ICRC3Value::Array(vec![ICRC3Value::Blob(ByteBuf::from(
                    serde_cbor::to_vec(&self.to).expect("couldn't serialize"),
                ))]),
            ),
        ];

        let mut data = vec![
            ("btype".into(), ICRC3Value::Text(btype)),
            ("ts".into(), ICRC3Value::Nat(self.timestamp.into())),
            ("tx".into(), ICRC3Value::Map(tx_data.into_iter().collect())),
            ("fee".into(), ICRC3Value::Nat(self.fee.into())),
        ];

        if let Some(memo) = self.memo {
            data.push(("memo".into(), ICRC3Value::Blob(ByteBuf::from(memo))));
        }

        // If non-genesis block, push the hash to parent
        if self.id > 0 {
            data.push((
                "phash".into(),
                ICRC3Value::Blob(ByteBuf::from(self.parent_hash)),
            ));
        }

        BlockWithId {
            id: self.id.into(),
            block: ICRC3GenericBlock::Map(data.into_iter().collect()),
        }
    }
}

pub fn transfer(
    state: &mut State,
    now: u64,
    owner: Principal,
    args: TransferArgs,
) -> Result<u128, TransferError> {
    let TransferArgs {
        from_subaccount,
        mut to,
        amount,
        created_at_time,
        fee,
        memo,
        ..
    } = args;

    if owner == icrc1_minting_account().expect("no minting account").owner {
        if !state.minting_mode {
            return Err(TransferError::GenericError(GenericError {
                error_code: 5,
                message: "minting invariant violation".into(),
            }));
        }
    } else if fee.is_none() {
        return Err(TransferError::GenericError(GenericError {
            error_code: 3,
            message: "only minting transactions are allowed without a fee".into(),
        }));
    }

    if state.voted_on_emergency_proposal(owner) {
        return Err(TransferError::GenericError(GenericError {
            error_code: 1,
            message: "transfers locked: a vote on a pending proposal detected".to_string(),
        }));
    }

    if memo.as_ref().map(|bytes| bytes.len()) > Some(32) {
        return Err(TransferError::GenericError(GenericError {
            error_code: 2,
            message: "memo longer than 32 bytes".to_string(),
        }));
    }

    // check the time
    let effective_time = created_at_time.unwrap_or(now);
    if effective_time + 5 * MINUTE < now {
        return Err(TransferError::TooOld);
    }
    if effective_time.saturating_sub(5 * MINUTE) > now {
        return Err(TransferError::CreatedInFuture(CreatedInFuture {
            ledger_time: now,
        }));
    }

    let subaccount = if from_subaccount
        .as_ref()
        .map(|val| val.iter().all(|b| b == &0))
        .unwrap_or(true)
    {
        None
    } else {
        from_subaccount
    };

    if to
        .subaccount
        .as_ref()
        .map(|val| val.len() == 32 && val.iter().all(|b| b == &0))
        .unwrap_or_default()
    {
        to.subaccount = None;
    }

    let from = Account { owner, subaccount };

    let balance = state.balances.get(&from).copied().unwrap_or_default();
    if from.owner != Principal::anonymous() && balance == 0 {
        return Err(TransferError::InsufficientFunds(InsufficientFunds {
            balance: 0,
        }));
    }
    let effective_fee = fee.unwrap_or(icrc1_fee()) as Token;
    if from.owner != Principal::anonymous() {
        let effective_amount = (amount as Token).saturating_add(effective_fee);
        if balance < effective_amount {
            return Err(TransferError::InsufficientFunds(InsufficientFunds {
                balance: balance as u128,
            }));
        }
        let resulting_balance = balance.saturating_sub(effective_amount);
        if resulting_balance == 0 {
            state.balances.remove(&from);
        } else {
            state.balances.insert(from.clone(), resulting_balance);
        }
        update_user_balance(state, from.owner, resulting_balance as Token);
    }
    if to.owner != Principal::anonymous() {
        let recipient_balance = state.balances.remove(&to).unwrap_or_default();
        let updated_balance = recipient_balance.saturating_add(amount as Token);
        state.balances.insert(to.clone(), updated_balance);
        update_user_balance(state, to.owner, updated_balance as Token);
    }

    let id = state.memory.ledger.len() as u32;

    let mut parent_hash: [u8; 32] = Default::default();
    if id > 0 {
        let parent_tx: BlockWithId = state
            .memory
            .ledger
            .get(&id.saturating_sub(1))
            .expect("no transaction found")
            .into();
        parent_hash.copy_from_slice(parent_tx.block.hash().as_slice());
    }

    let tx = Transaction {
        timestamp: now,
        from,
        to,
        amount: amount as Token,
        fee: effective_fee,
        memo,
        id,
        parent_hash,
    };
    let icrc3_block: BlockWithId = tx.clone().into();

    add_value_to_certify("last_block_index", leaf_hash(&id.to_be_bytes()));
    add_value_to_certify("last_block_hash", leaf_hash(&icrc3_block.block.hash()));
    certify();

    state
        .memory
        .ledger
        .insert(id, tx)
        .expect("couldn't insert a new transaction");
    state.token_fees_burned += effective_fee;
    Ok(id as u128)
}

fn update_user_balance(state: &mut State, principal: Principal, balance: Token) {
    let Some(user) = state.principal_to_user_mut(principal) else {
        return;
    };
    if user.principal == principal {
        user.balance = balance
    } else if user.cold_wallet == Some(principal) {
        user.cold_balance = balance
    } else {
        unreachable!("unidentifiable principal")
    }
}

pub fn account(owner: Principal) -> Account {
    Account {
        owner,
        subaccount: None,
    }
}

/// Smallest amount of non-fractional tokens
pub fn base() -> Token {
    10_u64.pow(CONFIG.token_decimals as u32)
}

pub fn mint(state: &mut State, account: Account, tokens: Token, memo: &str) {
    let now = time();
    let _result = transfer(
        state,
        now,
        icrc1_minting_account().expect("no minting account").owner,
        TransferArgs {
            from_subaccount: None,
            to: account,
            amount: tokens as u128,
            fee: None,
            memo: Some(memo.as_bytes().to_vec()),
            created_at_time: Some(now),
        },
    );
}

pub fn balances_from_ledger(
    ledger: &mut dyn Iterator<Item = Transaction>,
) -> Result<(HashMap<Account, Token>, Token), String> {
    let mut total_fees = 0;
    let mut balances = HashMap::new();
    let minting_account = icrc1_minting_account().ok_or("no minting account found")?;
    for transaction in ledger {
        if transaction.to != minting_account {
            if !balances.contains_key(&transaction.to) {
                balances.insert(transaction.to.clone(), transaction.amount);
            } else if let Some(balance) = balances.get_mut(&transaction.to) {
                *balance = (*balance).saturating_add(transaction.amount)
            }
        }
        if transaction.from != minting_account {
            let from = balances
                .get_mut(&transaction.from)
                .ok_or("paying account not found")?;
            if transaction
                .amount
                .checked_add(transaction.fee)
                .ok_or("invalid transaction")?
                > *from
            {
                return Err("account has not enough funds".into());
            }
            *from = from
                .checked_sub(
                    transaction
                        .amount
                        .checked_add(transaction.fee)
                        .ok_or("wrong amount")?,
                )
                .ok_or("wrong amount")?;
        }
        total_fees += transaction.fee;
    }
    Ok((balances, total_fees))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pr(n: u8) -> Principal {
        let v = vec![n];
        Principal::from_slice(&v)
    }

    #[test]
    fn test_transfers() {
        let mut state = State::default();
        env::tests::create_user(&mut state, pr(0));

        let memo = vec![0; 33];

        assert_eq!(
            transfer(
                &mut state,
                1000 * MINUTE,
                pr(0),
                TransferArgs {
                    from_subaccount: None,
                    to: account(pr(1)),
                    amount: 1,
                    fee: Some(1),
                    memo: Some(memo),
                    created_at_time: None
                }
            ),
            Err(TransferError::GenericError(GenericError {
                error_code: 2,
                message: "memo longer than 32 bytes".into()
            }))
        );

        assert_eq!(
            transfer(
                &mut state,
                1000 * MINUTE,
                pr(0),
                TransferArgs {
                    from_subaccount: None,
                    to: account(pr(1)),
                    amount: 1,
                    fee: Some(1),
                    memo: None,
                    created_at_time: None
                }
            ),
            Err(TransferError::InsufficientFunds(InsufficientFunds {
                balance: 0
            }))
        );

        assert_eq!(
            transfer(
                &mut state,
                100 * MINUTE,
                pr(0),
                TransferArgs {
                    from_subaccount: None,
                    to: account(pr(1)),
                    amount: 1,
                    fee: Some(1),
                    memo: None,
                    created_at_time: Some(94 * MINUTE)
                }
            ),
            Err(TransferError::TooOld)
        );

        assert_eq!(
            transfer(
                &mut state,
                100 * MINUTE,
                pr(0),
                TransferArgs {
                    from_subaccount: None,
                    to: account(pr(1)),
                    amount: 1,
                    fee: Some(1),
                    memo: None,
                    created_at_time: Some(106 * MINUTE)
                }
            ),
            Err(TransferError::CreatedInFuture(CreatedInFuture {
                ledger_time: 6000000000000
            }))
        );

        state.balances.insert(account(pr(0)), 1000);

        // Create an open proposal with a pending vote
        state.emergency_votes.insert(pr(0), 1000);

        assert_eq!(
            transfer(
                &mut state,
                time(),
                pr(0),
                TransferArgs {
                    from_subaccount: None,
                    to: account(pr(1)),
                    amount: 500,
                    fee: Some(1),
                    memo: None,
                    created_at_time: None
                }
            ),
            Err(TransferError::GenericError(GenericError {
                error_code: 1,
                message: "transfers locked: a vote on a pending proposal detected".to_string(),
            })),
        );

        state.emergency_votes.clear();

        assert_eq!(
            transfer(
                &mut state,
                time(),
                pr(0),
                TransferArgs {
                    from_subaccount: None,
                    to: account(pr(1)),
                    amount: 500,
                    fee: Some(1),
                    memo: None,
                    created_at_time: None
                }
            ),
            Ok(0),
        );
        assert_eq!(state.balances.get(&account(pr(0))), Some(&(1000 - 500 - 1)));
        assert_eq!(state.balances.get(&account(pr(1))), Some(&500));

        assert_eq!(
            transfer(
                &mut state,
                time(),
                pr(0),
                TransferArgs {
                    from_subaccount: None,
                    to: icrc1_minting_account().unwrap(),
                    amount: 350,
                    fee: Some(25),
                    memo: None,
                    created_at_time: None
                }
            ),
            Ok(1),
        );
        assert_eq!(
            state.balances.get(&account(pr(0))),
            Some(&(1000 - 500 - 1 - 350 - 25))
        );
        assert_eq!(state.balances.get(&icrc1_minting_account().unwrap()), None);

        assert_eq!(
            transfer(
                &mut state,
                time(),
                pr(0),
                TransferArgs {
                    from_subaccount: None,
                    to: account(pr(0)),
                    amount: 490,
                    fee: Some(1),
                    memo: None,
                    created_at_time: None
                }
            ),
            Err(TransferError::InsufficientFunds(InsufficientFunds {
                balance: 124
            }))
        );
    }
}
