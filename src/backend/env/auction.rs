use std::collections::BTreeSet;

use candid::Principal;
use ic_ledger_types::{
    AccountIdentifier, Memo, Subaccount, Tokens, DEFAULT_FEE, DEFAULT_SUBACCOUNT,
};
use serde::{Deserialize, Serialize};

use crate::{
    env::invoices::{self},
    id, mutate, read, time, E8s,
};

use super::{
    config::CONFIG,
    invoices::{main_account, principal_to_subaccount},
    token::{self, account, Token},
    user::UserId,
    State, Time,
};

pub const AUCTION_ICP_SUBACCOUNT: [u8; 32] = [
    0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1,
];

pub fn auction_account() -> AccountIdentifier {
    AccountIdentifier::new(&id(), &Subaccount(AUCTION_ICP_SUBACCOUNT))
}

#[derive(Clone, Eq, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Bid {
    pub user: UserId,
    pub amount: Token,
    // e8s for 1 TAGGR cent
    pub e8s_per_token: u64,
    timestamp: Time,
}

impl PartialOrd for Bid {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for Bid {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        if self.e8s_per_token != other.e8s_per_token {
            // prioritize higher bids
            return self.e8s_per_token.cmp(&other.e8s_per_token);
        }
        if self.timestamp != other.timestamp {
            // prioritize older bids
            return other.timestamp.cmp(&self.timestamp);
        }
        if self.amount != other.amount {
            // prioritize larger bids
            return self.amount.cmp(&other.amount);
        }
        self.user.cmp(&other.user)
    }
}

#[derive(Default, Serialize, Deserialize)]
pub struct Auction {
    pub amount: Token,
    bids: BTreeSet<Bid>,
    #[serde(default)]
    pub last_auction_price_e8s: u64,
}

impl Auction {
    /// Checks if there is a sell out.
    pub fn sell_out(&self) -> bool {
        self.bids.iter().map(|bid| bid.amount).sum::<u64>() >= self.amount
    }

    /// Returns the highest bids if they form a sell out.
    pub fn get_bids(&mut self) -> Vec<Bid> {
        if !self.sell_out() {
            return Default::default();
        }
        let mut amount = self.amount;
        let mut bids = Vec::default();

        while amount > 0 {
            let Some(bid) = self.bids.pop_last() else {
                break;
            };
            let eff_amount = bid.amount.min(amount);
            bids.push(Bid {
                user: bid.user,
                amount: eff_amount,
                e8s_per_token: bid.e8s_per_token,
                timestamp: bid.timestamp,
            });
            // if the bid was larger than tokens left, create a leftover bid
            if eff_amount < bid.amount {
                self.bids.insert(Bid {
                    user: bid.user,
                    amount: bid.amount - eff_amount,
                    e8s_per_token: bid.e8s_per_token,
                    timestamp: bid.timestamp,
                });
            }
            amount = amount.saturating_sub(eff_amount);
        }

        bids
    }

    /// Returns from the current auction the bids, the revenue and the computed market price.
    /// As a side effect, it adjusts the auction size according to the price change as compared
    /// to the previous auction.
    pub fn close(&mut self) -> (Vec<Bid>, E8s, E8s) {
        let bids = self.get_bids();
        if bids.is_empty() {
            return Default::default();
        }

        let icp_fee = DEFAULT_FEE.e8s();
        let mut revenue = 0;

        for bid in &bids {
            revenue += bid
                .amount
                .checked_mul(bid.e8s_per_token)
                .expect("overflow")
                // subtract the fee because we do not charge it when a bid is created
                .checked_sub(icp_fee)
                .expect("underflow");
        }

        // subtract the fee because we will move it to the treasury
        revenue = revenue.saturating_sub(icp_fee);

        let market_price = revenue / self.amount;

        // We compute the percentage of the price change since the last auction and apply this
        // delta to the token amount of the next auction. Hence, a growing price will lead to
        // more tokens getting auctioned and vice versa.
        let price_delta = market_price as f64 / self.last_auction_price_e8s as f64;
        let next_amount = (self.amount as f64 * price_delta) as u64;
        self.amount = next_amount
            .max(CONFIG.weekly_auction_size_tokens_min)
            .min(CONFIG.weekly_auction_size_tokens_max);
        self.last_auction_price_e8s = market_price;

        (bids, revenue, market_price)
    }
}

/// Cancels user's bid and returns the funds to user wallet.
pub async fn cancel_bid(principal: Principal) -> Result<u64, String> {
    let bid = mutate(|state| remove_bid(state, principal))?;

    let user_account = read(|state| {
        let user_principal = state
            .principal_to_user(principal)
            .expect("no user found")
            .principal;
        AccountIdentifier::new(&user_principal, &DEFAULT_SUBACCOUNT)
    });

    let funds = bid
        .amount
        .checked_mul(bid.e8s_per_token)
        .expect("overflow")
        .checked_sub(DEFAULT_FEE.e8s())
        .expect("nothing to refund");

    invoices::transfer(
        user_account,
        Tokens::from_e8s(funds),
        Memo(727),
        Some(Subaccount(AUCTION_ICP_SUBACCOUNT)),
    )
    .await
    .map_err(|err| {
        let msg = format!("couldn't withdraw funds from bid {:?}: {}", bid, err);
        mutate(|state| state.logger.error(&msg));
        msg
    })
}

fn remove_bid(state: &mut State, principal: Principal) -> Result<Bid, String> {
    let user_id = state
        .principal_to_user(principal)
        .ok_or("no user found")?
        .id;

    let bid = state
        .auction
        .bids
        .iter()
        .find(|bid| bid.user == user_id)
        .ok_or("no bids found")?
        .clone();
    state.auction.bids.retain(|bid| bid.user != user_id);

    Ok(bid)
}

fn has_bid(state: &State, principal: Principal) -> bool {
    state
        .principal_to_user(principal)
        .map(|user| state.auction.bids.iter().any(|bid| bid.user == user.id))
        .unwrap_or_default()
}

/// Creates a new user bid. Requires a transfer to the user subaccount before.
pub async fn create_bid(
    principal: Principal,
    amount: Token,
    e8s_per_token: u64,
) -> Result<(), String> {
    // cancel existing bid if necessary
    if read(|state| has_bid(state, principal)) {
        cancel_bid(principal).await?;
    }

    // deposit funds for the bid
    invoices::transfer(
        auction_account(),
        Tokens::from_e8s(amount.checked_mul(e8s_per_token).expect("overflow")),
        Memo(717),
        Some(principal_to_subaccount(&principal)),
    )
    .await
    .map_err(|err| format!("couldn't deposit funds: {}", err))?;

    mutate(|state| add_bid(state, principal, amount, e8s_per_token, time()))
}

// Adds user's bid. Expects no bids to exist from the same user.
fn add_bid(
    state: &mut State,
    principal: Principal,
    amount: Token,
    e8s_per_token: u64,
    timestamp: Time,
) -> Result<(), String> {
    if amount == 0 {
        return Err("invalid amount".into());
    }
    let user_id = state
        .principal_to_user(principal)
        .ok_or("no user found")?
        .id;

    assert!(
        !state.auction.bids.iter().any(|bid| bid.user == user_id),
        "no bids exist for the user"
    );

    state.auction.bids.insert(Bid {
        user: user_id,
        amount,
        e8s_per_token,
        timestamp,
    });
    Ok(())
}

/// When the auction was closed successfully, moves funds to the treasury.
pub async fn move_to_treasury(amount: u64) -> Result<u64, String> {
    invoices::transfer(
        main_account(),
        Tokens::from_e8s(amount),
        Memo(737),
        Some(Subaccount(AUCTION_ICP_SUBACCOUNT)),
    )
    .await
}

/// Checks if we could collect enough bids to close the auction.
/// If yes, mints the requested amount of tokens for each bidder and moves all funds to
/// treasury, converting them to revenue.
pub async fn close_auction() -> (u64, u64) {
    let (bids, revenue, market_price) = mutate(|state| {
        let (bids, revenue, market_price) = state.auction.close();
        if bids.is_empty() {
            state.logger.info("Auction skipped: not enough bids");
            return (bids, 0, 0);
        }

        state.minting_mode = true;
        for bid in &bids {
            let principal = state.users.get(&bid.user).expect("no user found").principal;
            token::mint(state, account(principal), bid.amount, "auction bid");
        }
        state.minting_mode = false;

        (bids, revenue, market_price)
    });

    if revenue == 0 {
        return (market_price, revenue);
    }

    if let Err(err) = move_to_treasury(revenue).await {
        mutate(|state| {
            state.logger.error(format!(
                "couldn't move funds from the auction to treasury: {}",
                err
            ));
            state
                .logger
                .error(format!("bids that were closed: {:?}", bids))
        });
        return (0, 0);
    }

    (market_price, revenue)
}

#[cfg(test)]
pub(crate) mod tests {
    use crate::{
        env::{
            auction::Auction,
            tests::{create_user, pr},
            token,
        },
        mutate,
    };

    use super::*;

    #[test]
    fn test_auction() {
        mutate(|state| {
            let one_icp = 100000000;

            for i in 0..3 {
                create_user(state, pr(i));
            }

            state.auction = Auction {
                amount: 15000,
                bids: Default::default(),
                last_auction_price_e8s: one_icp,
            };

            // wrong amount
            assert!(add_bid(state, pr(0), 0, 1, 0).is_err());

            // Bid 1 ICP for 100 TAGGR
            add_bid(state, pr(0), 10000, one_icp, 0).unwrap();
            assert!(!state.auction.sell_out());

            // Bid 2 ICP for 30 TAGGR
            add_bid(state, pr(1), 3000, 2 * one_icp, 0).unwrap();
            assert!(!state.auction.sell_out());

            // Bid 3 ICP for 22 TAGGR
            add_bid(state, pr(2), 2200, 3 * one_icp, 0).unwrap();
            assert!(state.auction.sell_out());

            // make sure we order correctly
            assert_eq!(
                state
                    .auction
                    .bids
                    .iter()
                    .map(|bid| bid.user)
                    .collect::<Vec<_>>(),
                vec![0, 1, 2]
            );

            // Now all users except the first one get what they bid for.
            // The first one (offering the lowest price) gets the left overs (two tokens less).
            let bids = state.auction.get_bids();

            assert_eq!(
                bids,
                vec![
                    Bid {
                        user: 2,
                        amount: 2200,
                        e8s_per_token: 3 * one_icp,
                        timestamp: 0
                    },
                    Bid {
                        user: 1,
                        amount: 3000,
                        e8s_per_token: 2 * one_icp,
                        timestamp: 0
                    },
                    Bid {
                        user: 0,
                        amount: 10000 - 200,
                        e8s_per_token: one_icp,
                        timestamp: 0
                    },
                ]
            );

            // make sure those who didn't get tokens, still have their bids
            assert_eq!(
                state.auction.bids.iter().cloned().collect::<Vec<_>>(),
                vec![Bid {
                    user: 0,
                    amount: 200,
                    e8s_per_token: one_icp,
                    timestamp: 0
                }]
            );
        })
    }

    #[test]
    fn test_bid_orders() {
        mutate(|state| {
            let one_icp = 100000000;

            for i in 0..3 {
                create_user(state, pr(i));
            }

            state.auction = Auction {
                amount: 15000,
                bids: Default::default(),
                last_auction_price_e8s: one_icp,
            };

            // Bid 1 ICP for 100 TAGGR
            add_bid(state, pr(0), 10000, one_icp, 0).unwrap();

            // Bid 1 ICP for 200 TAGGR but later
            add_bid(state, pr(1), 20000, one_icp, 1).unwrap();

            // make sure the last item is the older one even though they offer the same price
            assert_eq!(
                state.auction.bids.iter().cloned().collect::<Vec<_>>(),
                vec![
                    Bid {
                        user: 1,
                        amount: 20000,
                        e8s_per_token: one_icp,
                        timestamp: 1
                    },
                    Bid {
                        user: 0,
                        amount: 10000,
                        e8s_per_token: one_icp,
                        timestamp: 0
                    },
                ]
            );

            // cancel previous bids
            state.auction.bids.clear();

            // Bid 1 ICP for 111 tokens
            add_bid(state, pr(0), 111, one_icp, 0).unwrap();

            // Bid 1 ICP for 222 tokens at the same time
            add_bid(state, pr(1), 222, one_icp, 0).unwrap();

            // make sure the last item is the one with larger amount
            assert_eq!(
                state.auction.bids.iter().cloned().collect::<Vec<_>>(),
                vec![
                    Bid {
                        user: 0,
                        amount: 111,
                        e8s_per_token: one_icp,
                        timestamp: 0
                    },
                    Bid {
                        user: 1,
                        amount: 222,
                        e8s_per_token: one_icp,
                        timestamp: 0
                    },
                ]
            );
        });
    }

    #[test]
    fn test_auction_size() {
        mutate(|state| {
            let one_icp = 100000000;

            for i in 0..3 {
                create_user(state, pr(i));
            }

            state.auction = Auction {
                amount: 15000,
                bids: Default::default(),
                last_auction_price_e8s: one_icp,
            };

            // Bid 1 ICP for 100 TAGGR
            add_bid(state, pr(0), 10000, one_icp, 0).unwrap();
            assert!(!state.auction.sell_out());

            // Bid 2 ICP for 30 TAGGR
            add_bid(state, pr(1), 3000, 2 * one_icp, 0).unwrap();
            assert!(!state.auction.sell_out());

            // Bid 3 ICP for 22 TAGGR
            add_bid(state, pr(2), 2200, 3 * one_icp, 0).unwrap();
            assert!(state.auction.sell_out());

            let (bids, revenue, market_price) = state.auction.close();

            assert_eq!(bids.len(), 3);
            let expected_revenue = one_icp * (3 * 22 + 2 * 30 + 98) * token::base()
                - 3 * DEFAULT_FEE.e8s()
                - DEFAULT_FEE.e8s();
            assert_eq!(revenue, expected_revenue);
            let expected_market_price = expected_revenue / 15000;
            assert_eq!(market_price, expected_market_price);
            // The expected market price is about 1.49 ICP, this is a 49% increase, so we expect
            // the number of tokens to grow to about 150 * 1.49 = ~224 tokens.
            assert_eq!(expected_market_price, 149333330);
            assert_eq!(state.auction.amount, 22399);

            // Let's run another auction with the price doing x1000
            state.auction.bids.clear();
            state.auction.amount = 15000;

            // Bid 1k ICP for 100 TAGGR
            add_bid(state, pr(0), 10000, one_icp * 1000, 0).unwrap();
            assert!(!state.auction.sell_out());

            // Bid 2k ICP for 30 TAGGR
            add_bid(state, pr(1), 3000, 2 * one_icp * 1000, 0).unwrap();
            assert!(!state.auction.sell_out());

            // Bid 3k ICP for 22 TAGGR
            add_bid(state, pr(2), 2200, 3 * one_icp * 1000, 0).unwrap();
            assert!(state.auction.sell_out());

            let (_, revenue, market_price) = state.auction.close();

            let expected_revenue = 1000 * one_icp * (3 * 22 + 2 * 30 + 98) * token::base()
                - 3 * DEFAULT_FEE.e8s()
                - DEFAULT_FEE.e8s();
            assert_eq!(revenue, expected_revenue);
            let expected_market_price = expected_revenue / 15000;
            assert_eq!(market_price, expected_market_price);
            // We hit the ceiling and do not increase the auction size beyond the configured
            // maximum
            assert_eq!(expected_market_price, 149333333330);
            assert_eq!(state.auction.amount, 100000);

            // Let's run another auction with the price plummeting
            state.auction.bids.clear();
            state.auction.amount = 15000;

            let e8s = 1000;
            // Bid 1 E8 for 100 TAGGR
            add_bid(state, pr(0), 10000, e8s, 0).unwrap();
            assert!(!state.auction.sell_out());

            // Bid 2 e8s for 30 TAGGR
            add_bid(state, pr(1), 3000, 2 * e8s, 0).unwrap();
            assert!(!state.auction.sell_out());

            // Bid 3 e8s for 22 TAGGR
            add_bid(state, pr(2), 2200, 3 * e8s, 0).unwrap();
            assert!(state.auction.sell_out());

            let (_, revenue, market_price) = state.auction.close();

            let expected_revenue = e8s * (3 * 22 + 2 * 30 + 98) * token::base()
                - 3 * DEFAULT_FEE.e8s()
                - DEFAULT_FEE.e8s();
            assert_eq!(revenue, expected_revenue);
            let expected_market_price = expected_revenue / 15000;
            assert_eq!(market_price, expected_market_price);
            // We hit the floor and do not decrease the auction size below the configured minimum
            assert_eq!(expected_market_price, 1490);
            assert_eq!(state.auction.amount, 1500);
        })
    }
}
