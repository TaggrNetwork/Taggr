use candid::{CandidType, Principal};
use ic_cdk::{
    api::{id, time},
    spawn,
};
use ic_ledger_types::{
    AccountBalanceArgs, AccountIdentifier, BlockIndex, Memo, Subaccount, Tokens, TransferArgs,
    TransferResult, DEFAULT_FEE, DEFAULT_SUBACCOUNT, MAINNET_CYCLES_MINTING_CANISTER_ID,
    MAINNET_LEDGER_CANISTER_ID,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::{mutate, read};

use super::{bitcoin, canisters::call_canister, Time};

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
pub struct ICPInvoice {
    pub e8s: u64,
    pub paid_e8s: u64,
    pub paid: bool,
    time: u64,
    sub_account: Subaccount,
    pub account: AccountIdentifier,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct BTCInvoice {
    // Sats worth 1 XDR
    pub sats: u64,
    pub fee: u64,
    // Actually transferred sats
    pub balance: u64,
    pub paid: bool,
    time: u64,
    pub address: String,
    pub derivation_path: Vec<Vec<u8>>,
    // This is the percentile we use to estimate fees for transferring funds to the treasury.
    #[serde(default)]
    pub fee_percentile: usize,
    #[serde(default)]
    pub tx_id: Option<String>,
}

#[derive(Deserialize, Default, Serialize)]
pub struct Invoices {
    invoices: HashMap<Principal, ICPInvoice>,
    #[serde(default)]
    pub btc_invoices: HashMap<Principal, BTCInvoice>,
    // Contains all funds that have to be moved to the treasury address.
    #[serde(default)]
    pub pending_btc_invoices: Vec<BTCInvoice>,
}

impl Invoices {
    pub fn clean_up(&mut self, now: Time) {
        self.invoices
            .retain(|_, invoice| invoice.time + INVOICE_MAX_AGE_HOURS >= now);
        self.btc_invoices
            .retain(|_, invoice| invoice.time + INVOICE_MAX_AGE_HOURS >= now);
    }

    fn new_icp_invoice(invoice_id: Principal, e8s: u64) -> Result<ICPInvoice, String> {
        if e8s == 0 {
            return Err("wrong ICP/XDR ratio".into());
        }
        let time = time();
        let sub_account = principal_to_subaccount(&invoice_id);
        let account = AccountIdentifier::new(&id(), &sub_account);
        let invoice = ICPInvoice {
            paid: false,
            e8s,
            paid_e8s: 0,
            time,
            account,
            sub_account,
        };
        Ok(invoice)
    }

    async fn new_btc_invoice(invoice_id: Principal, sats: u64) -> Result<BTCInvoice, String> {
        if sats == 0 {
            return Err("wrong USD/BTC ratio".into());
        }
        // The derivation path contains the timestamp and the principal.
        let derivation_path = vec![
            time().to_be_bytes().to_vec(),
            invoice_id.as_slice().to_vec(),
        ];
        let fee_per_byte = bitcoin::get_fee_per_byte(25).await?;
        let address = bitcoin::get_address(derivation_path.clone()).await?;
        let invoice = BTCInvoice {
            paid: false,
            // We charge users with fees corresponding to 25'th percentile and assuming a 200 bytes tx size.
            fee: fee_per_byte * 200,
            sats,
            balance: 0,
            time: time(),
            address,
            derivation_path,
            fee_percentile: 10,
            tx_id: None,
        };
        Ok(invoice)
    }

    // Closes all invoices for the given principal id and assert that at least one of them was
    // paid. If the user paid both invoices, we do not handle this case.
    pub fn close_invoice(&mut self, invoice_id: &Principal) {
        let mut paid = false;
        if let Some(invoice) = self.invoices.remove(invoice_id) {
            paid = paid || invoice.paid
        }
        if let Some(invoice) = self.btc_invoices.remove(invoice_id) {
            if invoice.paid {
                paid = true;
                self.pending_btc_invoices.push(invoice);
            }
        }
        assert!(paid, "invoice paid");
    }

    pub async fn outstanding_icp_invoice(
        invoice_id: &Principal,
        kilo_credits: u64,
        e8s_for_one_xdr: u64,
    ) -> Result<ICPInvoice, String> {
        let invoice = match read(|state| state.accounting.invoices.get(invoice_id).cloned()) {
            Some(invoice) => invoice,
            None => {
                let invoice = Self::new_icp_invoice(*invoice_id, e8s_for_one_xdr)?;
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
            let rest = Tokens::from_e8s(
                balance
                    .e8s()
                    .saturating_sub(costs.e8s().checked_add(fee().e8s()).ok_or("wrong costs")?),
            );
            if rest > fee() {
                let future = transfer(
                    AccountIdentifier::new(invoice_id, &DEFAULT_SUBACCOUNT),
                    rest,
                    Memo(999),
                    Some(invoice.sub_account),
                );
                // We don't block on the transfer of remaining funds, because these funds are not
                // critical for the rest of the workflow.
                spawn(async {
                    let _ = future.await;
                });
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

    pub async fn outstanding_btc_invoice(
        invoice_id: &Principal,
        sats_for_one_xdr: u64,
    ) -> Result<BTCInvoice, String> {
        let invoice = match read(|state| state.accounting.btc_invoices.get(invoice_id).cloned()) {
            Some(invoice) => invoice,
            None => {
                let invoice = Self::new_btc_invoice(*invoice_id, sats_for_one_xdr).await?;
                mutate(|state| {
                    state
                        .accounting
                        .btc_invoices
                        .insert(*invoice_id, invoice.clone());
                });
                invoice
            }
        };
        if invoice.paid {
            return Ok(invoice);
        }
        let balance = bitcoin::balance(invoice.address.clone()).await?;
        let min_balance = invoice.sats + invoice.fee;
        if balance >= min_balance {
            return mutate(|state| {
                let invoice = state
                    .accounting
                    .btc_invoices
                    .get_mut(invoice_id)
                    .expect("no invoice found");
                invoice.paid = true;
                invoice.balance = balance;
                Ok(invoice.clone())
            });
        }

        Ok(invoice)
    }

    pub fn has_paid_icp_invoice(&self, principal_id: &Principal) -> bool {
        self.invoices
            .get(principal_id)
            .map(|invoice| invoice.paid)
            .unwrap_or_default()
    }

    pub fn has_paid_btc_invoice(&self, principal_id: &Principal) -> bool {
        self.btc_invoices
            .get(principal_id)
            .map(|invoice| invoice.paid)
            .unwrap_or_default()
    }
}

// Processes all BTC invoices in two steps:
// 1. create a transaction,
// 2. check the balance and if it has decreased, delete the invoice;
//    if the balance did not decrease, increase the fees and try again.
pub async fn process_btc_invoices() {
    let invoices = mutate(|state| std::mem::take(&mut state.accounting.pending_btc_invoices));
    if invoices.is_empty() {
        return;
    }

    let treasury_address = read(|state| state.bitcoin_treasury_address.clone());

    let mut total_sats = 0;
    let mut pending = Vec::new();
    for mut invoice in invoices {
        // If the invoice has a tx id already, check the balance and if it's smaller
        // than previously recorded, the transfer succeeded and we are done.
        if invoice.tx_id.as_ref().is_some() {
            let result = bitcoin::balance(invoice.address.clone()).await;
            match result {
                Ok(balance) => {
                    if balance < invoice.balance {
                        total_sats += invoice.balance;
                        continue;
                    } else {
                        // Increase fees by two percentiles.
                        invoice.fee_percentile = (invoice.fee_percentile + 2) % 100;
                    }
                }
                Err(err) => {
                    mutate(|state| {
                        state.logger.error(format!(
                            "Failed to fetch balance of address {}: {}",
                            &invoice.address, err
                        ));
                    });
                    pending.push(invoice);
                    continue;
                }
            }
        }

        // If we're here, then the invoice has either no tx id or the tx is still pending.
        // If a concurrent transfer happens while we're retrying below, we might submit a new transaction, but
        // it will fail because UTXOs are spent and we'll simply clean up the invoice on the next retry because the balance has decreased.
        let result = bitcoin::transfer(
            invoice.address.clone(),
            invoice.derivation_path.clone(),
            treasury_address.clone(),
            invoice.fee_percentile,
        )
        .await;
        match result {
            Ok(tx_id) => invoice.tx_id = Some(tx_id.to_string()),
            Err(err) => {
                mutate(|state| {
                    state.logger.error(format!(
                        "Failed to transfer {} sats from address {}: {}",
                        invoice.balance, &invoice.address, err
                    ))
                });
            }
        }
        pending.push(invoice);
    }

    // Put all pending invoices back.
    mutate(|state| {
        state
            .accounting
            .pending_btc_invoices
            .extend_from_slice(&pending)
    });

    if total_sats > 0 {
        mutate(|state| {
            state
                .logger
                .debug(format!("Transferred `{}` sats to BTC treasury", total_sats));
        });
        bitcoin::update_treasury_balance().await;
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

pub async fn topup_with_icp(canister_id: &Principal, icp: Tokens) -> Result<u128, String> {
    let block_index = transfer(
        AccountIdentifier::new(
            &MAINNET_CYCLES_MINTING_CANISTER_ID,
            &principal_to_subaccount(canister_id),
        ),
        icp,
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
