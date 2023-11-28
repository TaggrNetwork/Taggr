use super::{parse_amount, MINUTE};
use crate::*;
use base64::{engine::general_purpose, Engine as _};
use candid::{CandidType, Deserialize, Principal};
use serde::Serialize;

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
    from_subaccount: Option<Subaccount>,
    to: Account,
    amount: u128,
    fee: Option<u128>,
    memo: Option<Memo>,
    created_at_time: Option<Timestamp>,
}

#[derive(Serialize, Deserialize)]
pub struct Transaction {
    pub timestamp: u64,
    pub from: Account,
    pub to: Account,
    pub amount: Token,
    pub fee: Token,
    pub memo: Option<Memo>,
}

// pub struct BadFee {
//     expected_fee: u64,
// }

// pub struct BadBurn {
//     min_burn_amount: u64,
// }

// pub struct Duplicate {
//     duplicate_of: u64,
// }

#[derive(CandidType, Debug, PartialEq, Serialize)]
pub struct InsufficientFunds {
    balance: u128,
}

#[derive(CandidType, Debug, PartialEq, Serialize)]
pub struct CreatedInFuture {
    ledger_time: Timestamp,
}

#[derive(CandidType, Debug, PartialEq, Serialize)]
pub struct GenericError {
    error_code: u128,
    message: String,
}

#[derive(CandidType, Debug, PartialEq, Serialize)]
pub enum TransferError {
    // BadFee(BadFee),
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
fn icrc1_fee() -> u128 {
    CONFIG.transaction_fee as u128
}

#[query]
fn icrc1_total_supply() -> u128 {
    CONFIG.total_supply as u128
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
    vec![Standard {
        name: "ICRC-1".into(),
        url: "https://github.com/dfinity/ICRC-1".into(),
    }]
}

#[update]
fn icrc1_transfer(args: TransferArgs) -> Result<u128, TransferError> {
    let owner = caller();
    if owner == Principal::anonymous() {
        return Err(TransferError::GenericError(GenericError {
            error_code: 0,
            message: "No transfers from the minting account possible.".into(),
        }));
    }
    mutate(|state| transfer(state, time(), owner, args))
}

fn transfer(
    state: &mut State,
    now: u64,
    owner: Principal,
    args: TransferArgs,
) -> Result<u128, TransferError> {
    let TransferArgs {
        from_subaccount,
        to,
        amount,
        fee,
        created_at_time,
        memo,
        ..
    } = args;

    if state.voted_on_pending_proposal(owner) {
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
    let from = Account { owner, subaccount };

    let balance = state.balances.get(&from).copied().unwrap_or_default();
    if from.owner != Principal::anonymous() && balance == 0 {
        return Err(TransferError::InsufficientFunds(InsufficientFunds {
            balance: 0,
        }));
    }
    let effective_fee = fee.unwrap_or_else(icrc1_fee) as Token;
    if from.owner != Principal::anonymous() {
        let effective_amount = amount as Token + effective_fee;
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
    }
    if to.owner != Principal::anonymous() {
        let recipient_balance = state.balances.remove(&to).unwrap_or_default();
        state
            .balances
            .insert(to.clone(), recipient_balance + amount as Token);
    }
    state.ledger.push(Transaction {
        timestamp: now,
        from,
        to,
        amount: amount as Token,
        fee: effective_fee,
        memo,
    });
    Ok(state.ledger.len().saturating_sub(1) as u128)
}

pub fn account(owner: Principal) -> Account {
    Account {
        owner,
        subaccount: None,
    }
}

pub fn mint(state: &mut State, account: Account, tokens: Token) {
    let now = time();
    let _result = transfer(
        state,
        now,
        icrc1_minting_account().expect("no minting account").owner,
        TransferArgs {
            from_subaccount: None,
            to: account,
            amount: tokens as u128,
            fee: Some(0),
            memo: None,
            created_at_time: Some(now),
        },
    );
}

pub fn move_funds(state: &mut State, from: &Account, to: Account) -> Result<u128, TransferError> {
    let balance = state.balances.get(from).copied().unwrap_or_default();
    let mut n = 0;
    if balance > 0 {
        let fee = icrc1_fee();
        n = transfer(
            state,
            time(),
            from.owner,
            TransferArgs {
                from_subaccount: from.subaccount.clone(),
                to,
                amount: (balance - fee as Token) as u128,
                fee: None,
                memo: Default::default(),
                created_at_time: None,
            },
        )?;
    }
    state.balances.remove(from);
    Ok(n)
}

pub fn user_transfer(recipient: String, amount: String) -> Result<u64, String> {
    let minted_supply: Token = read(|state| state.balances.values().sum());

    if minted_supply * 100 < CONFIG.supply_threshold_for_transfer_percentage * CONFIG.total_supply {
        return Err(format!(
            "transfers will be enabled when the minted supply reaches {}% of total supply",
            CONFIG.supply_threshold_for_transfer_percentage
        ));
    }

    let recipient_principal = Principal::from_text(recipient)
        .map_err(|err| format!("couldn't parse the recipient: {:?}", err))?;

    let transaction_id = icrc1_transfer(TransferArgs {
        from_subaccount: None,
        to: account(recipient_principal),
        amount: parse_amount(&amount, CONFIG.token_decimals)? as u128,
        fee: Some(icrc1_fee()),
        memo: None,
        created_at_time: Some(time()),
    })
    .map(|n| n as u64)
    .map_err(|err| format!("transfer failed: {:?}", err))?;

    mutate(|state| {
        if let (Some(sender_name), Some(recipient)) = (
            state
                .principal_to_user(caller())
                .map(|user| user.name.clone()),
            state.principal_to_user_mut(recipient_principal),
        ) {
            recipient.notify(format!(
                "You received `{}` ${} from @{}! 💸",
                amount, CONFIG.token_symbol, sender_name
            ));
        }
    });

    Ok(transaction_id)
}

#[cfg(test)]
mod tests {
    use crate::env::proposals::{Proposal, Status};

    use super::*;

    fn pr(n: u8) -> Principal {
        let v = vec![n];
        Principal::from_slice(&v)
    }

    #[test]
    fn test_transfers() {
        let mut state = State::default();
        env::tests::create_user(&mut state, pr(0));

        let mut memo = Vec::new();
        memo.resize(33, 0);

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
        state.proposals.push(Proposal {
            proposer: 0,
            bulletins: vec![(0, true, 1)],
            status: Status::Open,
            ..Default::default()
        });

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

        state.proposals.clear();

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
                    amount: 490,
                    fee: Some(1),
                    memo: None,
                    created_at_time: None
                }
            ),
            Ok(1),
        );
        assert_eq!(
            state.balances.get(&account(pr(0))),
            Some(&(1000 - 500 - 1 - 490 - 1))
        );
        assert_eq!(state.balances.get(&icrc1_minting_account().unwrap()), None,);

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
                balance: 8
            }))
        );
    }
}

pub fn balances_from_ledger(ledger: &[Transaction]) -> Result<HashMap<Account, Token>, String> {
    let mut balances = HashMap::new();
    let minting_account = icrc1_minting_account().ok_or("no minting account found")?;
    for transaction in ledger {
        balances
            .entry(transaction.to.clone())
            .and_modify(|balance| *balance += transaction.amount)
            .or_insert(transaction.amount);
        if transaction.from != minting_account {
            let from = balances
                .get_mut(&transaction.from)
                .ok_or("paying account not found")?;
            if transaction.amount + transaction.fee > *from {
                return Err("account has not enough funds".into());
            }
            *from -= transaction.amount + transaction.fee;
        }
    }
    Ok(balances)
}
