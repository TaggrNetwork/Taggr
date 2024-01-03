use candid::{CandidType, Principal};
use ic_cdk::api::{id, time};
use ic_ledger_types::{
    AccountBalanceArgs, AccountIdentifier, BlockIndex, Memo, Subaccount, Tokens, TransferArgs,
    TransferResult, DEFAULT_FEE, DEFAULT_SUBACCOUNT, MAINNET_CYCLES_MINTING_CANISTER_ID,
    MAINNET_LEDGER_CANISTER_ID,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::{mutate, read};

use super::canisters::call_canister;

const INVOICE_MAX_AGE_HOURS: u64 = 24 * super::HOUR;

#[derive(CandidType, Deserialize)]
struct IcpXdrConversionRate {
    xdr_permyriad_per_icp: u64,
}

#[derive(CandidType, Deserialize)]
struct IcpXdrConversionRateCertifiedResponse {
    data: IcpXdrConversionRate,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct Invoice {
    pub e8s: u64,
    pub paid_e8s: u64,
    pub paid: bool,
    time: u64,
    sub_account: Subaccount,
    pub account: AccountIdentifier,
}

#[derive(Deserialize, Default, Serialize)]
pub struct Invoices {
    invoices: HashMap<Principal, Invoice>,
}

impl Invoices {
    pub fn clean_up(&mut self) {
        self.invoices
            .retain(|_, invoice| time() - invoice.time < INVOICE_MAX_AGE_HOURS)
    }

    fn create(invoice_id: Principal, e8s: u64) -> Result<Invoice, String> {
        if e8s == 0 {
            return Err("wrong ICP/XDR ratio".into());
        }
        let time = time();
        let sub_account = principal_to_subaccount(&invoice_id);
        let account = AccountIdentifier::new(&id(), &sub_account);
        let invoice = Invoice {
            paid: false,
            e8s,
            paid_e8s: 0,
            time,
            account,
            sub_account,
        };
        Ok(invoice)
    }

    pub fn close(&mut self, invoice_id: &Principal) {
        self.invoices.remove(invoice_id);
    }

    pub async fn outstanding(
        invoice_id: &Principal,
        kilo_credits: u64,
        e8s_for_one_xdr: u64,
    ) -> Result<Invoice, String> {
        let invoice = match read(|state| state.accounting.invoices.get(invoice_id).cloned()) {
            Some(invoice) => invoice,
            None => {
                let invoice = Self::create(*invoice_id, e8s_for_one_xdr)?;
                mutate(|state| {
                    state
                        .accounting
                        .invoices
                        .insert(*invoice_id, invoice.clone());
                });
                invoice
            }
        };
        if invoice.paid {
            return Ok(invoice);
        }
        let balance = account_balance(invoice.account).await?;
        let costs = Tokens::from_e8s(kilo_credits.max(1) * invoice.e8s);
        if balance >= costs {
            transfer(main_account(), costs, Memo(999), Some(invoice.sub_account)).await?;
            // If after minting we still have some balance, move it to user's wallet.
            let rest = balance - costs - fee();
            if rest > fee() {
                transfer(
                    AccountIdentifier::new(invoice_id, &DEFAULT_SUBACCOUNT),
                    rest,
                    Memo(999),
                    Some(invoice.sub_account),
                )
                .await?;
            }
            mutate(|state| {
                if let Some(invoice) = state.accounting.invoices.get_mut(invoice_id) {
                    invoice.paid = true;
                    invoice.paid_e8s = costs.e8s();
                }
            });
        } else if kilo_credits > 0 {
            return Err(format!(
                "ICP balance too low (need: {} ICP, got: {} ICP)",
                costs, balance
            ));
        }
        read(|state| state.accounting.invoices.get(invoice_id).cloned())
            .ok_or("no invoice found".into())
    }
}

pub fn fee() -> Tokens {
    DEFAULT_FEE
}

pub fn main_account() -> AccountIdentifier {
    AccountIdentifier::new(&id(), &DEFAULT_SUBACCOUNT)
}

pub const USER_ICP_SUBACCOUNT: [u8; 32] = [1; 32];

pub async fn transfer(
    to: AccountIdentifier,
    amount: Tokens,
    memo: Memo,
    sub_account: Option<Subaccount>,
) -> Result<BlockIndex, String> {
    if amount < DEFAULT_FEE {
        return Err("can't transfer amounts smaller than the fee".into());
    }
    let (result,): (TransferResult,) = call_canister(
        MAINNET_LEDGER_CANISTER_ID,
        "transfer",
        (TransferArgs {
            created_at_time: None,
            memo,
            amount: amount - DEFAULT_FEE,
            fee: DEFAULT_FEE,
            to,
            from_subaccount: sub_account,
        },),
    )
    .await
    .map_err(|err| format!("call to ledger failed: {:?}", err))?;
    result.map_err(|err| {
        format!(
            "transfer of `{}` ICP from `{}` failed: {:?}",
            amount,
            AccountIdentifier::new(&id(), &sub_account.unwrap_or(DEFAULT_SUBACCOUNT)),
            err
        )
    })
}

pub async fn account_balance(account: AccountIdentifier) -> Result<Tokens, String> {
    let (balance,): (Tokens,) = call_canister(
        MAINNET_LEDGER_CANISTER_ID,
        "account_balance",
        (AccountBalanceArgs { account },),
    )
    .await
    .map_err(|err| format!("couldn't check balance: {:?}", err))?;
    Ok(balance)
}

pub async fn get_xdr_in_e8s() -> Result<u64, String> {
    let (IcpXdrConversionRateCertifiedResponse {
        data: IcpXdrConversionRate {
            xdr_permyriad_per_icp,
        },
    },) = call_canister(
        MAINNET_CYCLES_MINTING_CANISTER_ID,
        "get_icp_xdr_conversion_rate",
        (),
    )
    .await
    .map_err(|err| format!("couldn't get ICP/XDR ratio: {:?}", err))?;
    Ok((100_000_000.0 / xdr_permyriad_per_icp as f64) as u64 * 10_000)
}

pub async fn topup_with_icp(canister_id: &Principal, xdrs: u64) -> Result<u128, String> {
    let e8s = xdrs * get_xdr_in_e8s().await?;
    let block_index = transfer(
        AccountIdentifier::new(
            &MAINNET_CYCLES_MINTING_CANISTER_ID,
            &principal_to_subaccount(canister_id),
        ),
        Tokens::from_e8s(e8s),
        Memo(0x50555054),
        None,
    )
    .await?;
    notify(*canister_id, block_index).await
}

async fn notify(canister_id: Principal, block_index: u64) -> Result<u128, String> {
    #[derive(CandidType)]
    struct NotifyTopUpArg {
        block_index: u64,
        canister_id: Principal,
    }

    #[derive(CandidType, Debug, Deserialize)]
    pub enum NotifyError {
        Refunded {
            reason: String,
            block_index: Option<u64>,
        },
        InvalidTransaction(String),
        TransactionTooOld(u64),
        Processing,
        Other {
            error_code: u64,
            error_message: String,
        },
    }

    let (result,): (Result<u128, NotifyError>,) = call_canister(
        MAINNET_CYCLES_MINTING_CANISTER_ID,
        "notify_top_up",
        (NotifyTopUpArg {
            canister_id,
            block_index,
        },),
    )
    .await
    .map_err(|err| format!("couldn't notify the CMC canister: {:?}", err))?;
    result.map_err(|err| format!("CMC notification failed: {:?}", err))
}

pub fn principal_to_subaccount(principal_id: &Principal) -> Subaccount {
    let mut subaccount = [0; std::mem::size_of::<Subaccount>()];
    let principal_id = principal_id.as_slice();
    subaccount[0] = principal_id.len() as u8;
    subaccount[1..1 + principal_id.len()].copy_from_slice(principal_id);
    Subaccount(subaccount)
}
