use std::collections::HashMap;
use std::convert::TryFrom;

use super::config::CONFIG;
use super::post::{Extension, Post, PostId};
use super::token::{self, account};
use super::user::Predicate;
use super::{features, invoices, RealmId, Time, HOUR, WEEK};
use super::{user::UserId, State};
use crate::mutate;
use crate::token::Token;
use candid::Principal;
use ic_cdk::spawn;
use ic_cdk_timers::set_timer;
use ic_ledger_types::{AccountIdentifier, Memo, Tokens};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub enum Status {
    #[default]
    Open,
    Rejected,
    Executed,
    Cancelled,
}

#[derive(Default, Serialize, Deserialize)]
pub struct ReleaseInfo {
    post_id: PostId,
    timestamp: Time,
    commit: String,
    pub hash: String,
}

#[derive(Deserialize, Serialize)]
pub struct Release {
    pub commit: String,
    pub hash: String,
    #[serde(skip)]
    pub binary: Vec<u8>,
    #[serde(default)]
    pub closed_features: Vec<PostId>,
}

type ProposedReward = Token;

#[derive(Deserialize, Serialize)]
pub struct Rewards {
    pub receiver: Principal,
    #[serde(default)]
    pub submissions: HashMap<UserId, ProposedReward>,
    pub minted: Token,
}

#[derive(Default, Serialize, Deserialize)]
pub enum Payload {
    #[default]
    Noop,
    Release(Release),
    ICPTransfer(AccountIdentifier, Tokens),
    AddRealmController(RealmId, UserId),
    Funding(Principal, Token),
    Rewards(Rewards),
}

#[derive(Default, Serialize, Deserialize)]
pub struct Proposal {
    pub id: u32,
    pub proposer: UserId,
    pub timestamp: Time,
    pub post_id: PostId,
    pub status: Status,
    pub payload: Payload,
    pub bulletins: Vec<(UserId, bool, Token)>,
    pub voting_power: Token,
    #[serde(default)]
    pub escrow_tokens: Token,
}

impl TryFrom<&Proposal> for ReleaseInfo {
    type Error = String;

    fn try_from(proposal: &Proposal) -> Result<Self, Self::Error> {
        match &proposal.payload {
            Payload::Release(Release { commit, hash, .. }) => Ok(ReleaseInfo {
                post_id: proposal.post_id,
                timestamp: proposal.timestamp,
                commit: commit.clone(),
                hash: hash.clone(),
            }),
            _ => Err("wrong proposal type".into()),
        }
    }
}

impl Proposal {
    fn vote(
        &mut self,
        state: &State,
        principal: Principal,
        approve: bool,
        data: &str,
    ) -> Result<(), String> {
        let user = state.principal_to_user(principal).ok_or("no user found")?;
        if self.bulletins.iter().any(|(voter, _, _)| *voter == user.id) {
            return Err("double vote".into());
        }
        let balance = user.total_balance();
        if balance == 0 {
            return Err("only token holders can vote".into());
        }

        match &mut self.payload {
            Payload::Release(release) => {
                if approve && release.hash != data {
                    return Err("wrong hash".into());
                }
            }
            Payload::Funding(receiver, _) => {
                if receiver == &principal {
                    return Err("reward receivers can not vote".into());
                }
            }
            Payload::Rewards(Rewards {
                submissions,
                receiver,
                ..
            }) => {
                if receiver == &principal {
                    return Err("reward receivers can not vote".into());
                }
                let base = token::base();
                let max_funding_amount = CONFIG.max_funding_amount / base;
                let tokens = if approve {
                    data.parse::<Token>()
                        .map_err(|err| format!("couldn't parse the token amount: {err}"))?
                } else {
                    0
                };
                if tokens > max_funding_amount {
                    return Err(format!(
                        "reward amount is higher than the configured maximum of {} tokens",
                        max_funding_amount
                    ));
                }
                submissions.insert(user.id, tokens * base);
            }
            _ => {}
        }

        self.bulletins.push((user.id, approve, balance));
        Ok(())
    }

    fn execute(&mut self, state: &mut State, time: u64) -> Result<(), String> {
        // Update the voting power on all bullet-ins because users might have
        // transferred their tokens by now.
        for (user_id, _, balance) in self.bulletins.iter_mut() {
            *balance = state
                .users
                .get(user_id)
                .expect("no user found")
                .total_balance();
        }

        let supply_of_users_total = state.active_voting_power(time);
        // decrease the total number according to the delay
        let delay =
            ((100 - (time.saturating_sub(self.timestamp) / (HOUR * 24))).max(1)) as f64 / 100.0;
        let voting_power = (supply_of_users_total as f64 * delay) as u64;
        self.voting_power = voting_power;

        let proposer = state
            .users
            .get(&self.proposer)
            .ok_or("user not found")?
            .principal;
        let (approvals, rejects): (Token, Token) =
            self.bulletins
                .iter()
                .fold((0, 0), |(approvals, rejects), (_, approved, balance)| {
                    if *approved {
                        (approvals + balance, rejects)
                    } else {
                        (approvals, rejects + balance)
                    }
                });

        // Proposal rejected.
        if rejects * 100 >= voting_power * (100 - CONFIG.proposal_approval_threshold) as u64 {
            self.status = Status::Rejected;
            // if proposal was not rejected with a controversion, mint  burned tokens for the proposer.
            // Controversial rejection means approving VP is below 10% of rejecting VP.
            if approvals * 100 >= rejects * CONFIG.proposal_controversy_threshold as u64 {
                mint_tokens(
                    state,
                    proposer,
                    self.escrow_tokens,
                    format!("escrow proposal {}", self.id).as_str(),
                )?;
            }
            return Ok(());
        }

        // Proposal accepted.
        if approvals * 100 >= voting_power * CONFIG.proposal_approval_threshold as u64 {
            match &mut self.payload {
                Payload::Release(release) => {
                    for feature_id in &release.closed_features {
                        if let Err(err) = features::close_feature(state, *feature_id) {
                            state
                                .logger
                                .error(format!("couldn't close feature: {}", err));
                        }
                    }
                }
                Payload::Funding(receiver, tokens) => {
                    mint_tokens(state, *receiver, *tokens, "funding proposal")?
                }
                Payload::Rewards(reward) => {
                    let votes = reward
                        .submissions
                        .iter()
                        .map(|(user_id, proposed_reward)| {
                            (
                                state
                                    .users
                                    .get(user_id)
                                    .expect("no user found")
                                    .total_balance(),
                                *proposed_reward,
                            )
                        })
                        .collect::<Vec<_>>();
                    let total: Token = votes.iter().map(|(vp, _)| vp).sum();
                    let tokens_to_mint: Token = votes.iter().fold(0.0, |acc, (vp, reward)| {
                        acc + *vp as f32 / total as f32 * *reward as f32
                    }) as Token;
                    mint_tokens(state, reward.receiver, tokens_to_mint, "reward proposal")?;
                    reward.minted = tokens_to_mint;
                }
                Payload::AddRealmController(realm_id, user_id) => {
                    if let Some(realm) = state.realms.get_mut(&realm_id.to_uppercase()) {
                        realm.controllers.insert(*user_id);
                        state.logger.info(format!(
                            "User `{}` was added via proposal execution to the realm /{}",
                            user_id, realm_id
                        ));
                    }
                }
                Payload::ICPTransfer(account, amount) => {
                    let amount = *amount;
                    let account = *account;
                    set_timer(std::time::Duration::from_secs(1), move || {
                        spawn(async move {
                            if let Err(err) =
                                invoices::transfer(account, amount, Memo(828282), None).await
                            {
                                mutate(|state| {
                                    state.logger.error(format!(
                                        "The execution of the ICP transfer proposal failed: {}",
                                        err
                                    ))
                                })
                            };
                        })
                    });
                }
                _ => {}
            }

            self.status = Status::Executed;

            mint_tokens(
                state,
                proposer,
                self.escrow_tokens,
                format!("escrow proposal {}", self.id).as_str(),
            )?;
        }

        Ok(())
    }
}

fn mint_tokens(
    state: &mut State,
    receiver: Principal,
    mut tokens: Token,
    memo: &str,
) -> Result<(), String> {
    state.minting_mode = true;
    crate::token::mint(state, account(receiver), tokens, memo);
    state.minting_mode = false;
    tokens /= token::base();
    state.logger.info(format!(
        "`{}` ${} tokens were minted for `{}` via proposal execution.",
        tokens, CONFIG.token_symbol, receiver
    ));
    if let Some(user) = state.principal_to_user_mut(receiver) {
        user.notify(format!(
            "`{}` ${} tokens were minted for you via proposal execution.",
            tokens, CONFIG.token_symbol,
        ))
    }
    Ok(())
}

impl Payload {
    pub fn validate(&self, state: &State) -> Result<(), String> {
        let current_supply: Token = state.balances.values().sum();
        match self {
            Payload::AddRealmController(realm_id, user_id) => {
                if !state.users.contains_key(user_id) {
                    return Err("user not found".to_string());
                }
                if !state.realms.contains_key(&realm_id.to_uppercase()) {
                    return Err("realm not found".to_string());
                }
            }
            Payload::Release(release) => {
                if release.commit.is_empty() {
                    return Err("commit is not specified".to_string());
                }
                if release.binary.is_empty() {
                    return Err("binary is missing".to_string());
                }
            }
            Payload::Funding(_, tokens) => {
                if current_supply >= CONFIG.maximum_supply {
                    return Err(
                        "no funding is allowed when the current supply is above maximum".into(),
                    );
                }
                let max_funding_amount = CONFIG.max_funding_amount;
                if *tokens > max_funding_amount {
                    return Err(format!(
                        "funding amount is higher than the configured maximum of {} tokens",
                        max_funding_amount
                    ));
                }
            }
            Payload::Rewards(_) => {
                if current_supply >= CONFIG.maximum_supply {
                    return Err(
                        "no rewards are allowed when the current supply is above maximum".into(),
                    );
                }
            }
            _ => {}
        }
        Ok(())
    }
}

pub fn create_proposal(
    state: &mut State,
    caller: Principal,
    post_id: PostId,
    mut payload: Payload,
    time: u64,
) -> Result<u32, String> {
    if state
        .principal_to_user(caller)
        .map(|user| {
            user.controversial(time)
                || user.timestamp + WEEK * CONFIG.min_stalwart_account_age_weeks > time
        })
        .unwrap_or(true)
    {
        return Err("untrusted account".into());
    }

    payload.validate(state)?;

    let id = state.proposals.len() as u32;
    let market_price = state.auction.last_auction_price_e8s;
    let escrow_tokens = if market_price == 0 {
        0
    } else {
        state.e8s_for_one_xdr * CONFIG.proposal_escrow_amount_xdr / market_price
    };
    token::burn(
        state,
        caller,
        escrow_tokens,
        format!("escrow proposal {}", id).as_str(),
    )
    .map_err(|err| format!("{:?}", err))?;

    if let Payload::Release(release) = &mut payload {
        let mut hasher = Sha256::new();
        hasher.update(&release.binary);
        release.hash = format!("{:x}", hasher.finalize());
    }

    let user = state
        .principal_to_user_mut(caller)
        .expect("proposer user not found");
    if !user.realms.contains(&CONFIG.dao_realm.to_owned()) {
        user.realms.push(CONFIG.dao_realm.to_owned());
    }
    let proposer = user.id;
    let proposer_name = user.name.clone();
    // invalidate some previous proposals depending on their type
    state
        .proposals
        .iter_mut()
        .filter(|p| {
            p.status == Status::Open
                && matches!(p.payload, Payload::Release(_))
                && matches!(payload, Payload::Release(_))
        })
        .for_each(|proposal| {
            proposal.status = Status::Cancelled;
        });

    state.proposals.push(Proposal {
        post_id,
        proposer,
        timestamp: time,
        status: Status::Open,
        payload,
        bulletins: Vec::default(),
        voting_power: 0,
        escrow_tokens,
        id,
    });
    state.notify_with_predicate(
        &|user| {
            user.governance && user.active_within_weeks(time, 1) && user.balance > token::base()
        },
        format!("@{} submitted a new proposal", &proposer_name,),
        Predicate::Proposal(post_id),
    );
    Post::mutate(state, &post_id, |post| {
        assert_eq!(proposer, post.user, "post author differs from the proposer");
        assert!(post.extension.is_none(), "post cannot have any extensions");
        post.extension = Some(Extension::Proposal(id));
        Ok(())
    })
    .expect("couldn't mutate post");
    state.logger.info(format!(
        "@{} submitted a new [proposal](#/post/{}).",
        &proposer_name, post_id
    ));
    Ok(id)
}

pub fn vote_on_proposal(
    state: &mut State,
    time: u64,
    caller: Principal,
    proposal_id: u32,
    approved: bool,
    data: &str,
) -> Result<(), String> {
    let mut proposals = std::mem::take(&mut state.proposals);
    let proposal = proposals
        .get_mut(proposal_id as usize)
        .ok_or_else(|| "no proposals founds".to_string())?;
    if proposal.status != Status::Open {
        state.proposals = proposals;
        return Err("last proposal is not open".into());
    }
    if let Err(err) = proposal.vote(state, caller, approved, data) {
        state.proposals = proposals;
        return Err(err);
    }
    state.proposals = proposals;
    execute_proposal(state, proposal_id, time)
}

pub fn cancel_proposal(
    state: &mut State,
    caller: Principal,
    proposal_id: u32,
) -> Result<(), String> {
    let mut proposals = std::mem::take(&mut state.proposals);
    let proposal = proposals
        .get_mut(proposal_id as usize)
        .expect("no proposals founds");
    let user = state.principal_to_user(caller).expect("no user found");
    if proposal.status == Status::Open && proposal.proposer == user.id {
        proposal.status = Status::Cancelled;
        mint_tokens(
            state,
            caller,
            proposal.escrow_tokens,
            format!("escrow proposal {}", proposal.id).as_str(),
        )?;
    }
    state.proposals = proposals;
    Ok(())
}

pub(super) fn execute_proposal(
    state: &mut State,
    proposal_id: u32,
    time: u64,
) -> Result<(), String> {
    let mut proposals = std::mem::take(&mut state.proposals);
    let proposal = proposals
        .get_mut(proposal_id as usize)
        .ok_or_else(|| "no proposals founds".to_string())?;
    if proposal.status != Status::Open {
        state.proposals = proposals;
        return Err("last proposal is not open".into());
    }
    let previous_state = proposal.status.clone();
    let result = proposal.execute(state, time);
    if let Err(err) = &result {
        state
            .logger
            .error(format!("Proposal execution failed: {:?}", err));
    }
    if previous_state != proposal.status {
        state.denotify_users(&|user| user.active_within_weeks(time, 1) && user.balance > 0);
    }
    state.proposals = proposals;
    result
}

#[cfg(test)]
pub mod tests {

    use super::*;
    use crate::{
        env::{
            tests::{create_user, insert_balance, pr},
            token::{transfer, TransferArgs},
        },
        read,
        reports::Report,
    };

    pub fn propose(
        state: &mut State,
        caller: Principal,
        description: String,
        payload: Payload,
        time: u64,
    ) -> Result<u32, String> {
        let post_id = Post::create(state, description, &[], caller, time, None, None, None)?;
        create_proposal(state, caller, post_id, payload, time)
    }

    fn time() -> Time {
        CONFIG.min_stalwart_account_age_weeks * WEEK
    }

    #[test]
    fn test_untrusted_accounts() {
        mutate(|state| {
            create_user(state, pr(1));
            insert_balance(state, pr(1), 1000 * 100);
            let post_id =
                Post::create(state, "hello world".into(), &[], pr(1), 0, None, None, None).unwrap();

            assert_eq!(
                create_proposal(state, pr(1), post_id, Payload::Noop, 0),
                Err("untrusted account".into())
            );

            // Users with reports are rejected.
            create_user(state, pr(2));
            insert_balance(state, pr(2), 1000 * 100);
            let user = state.principal_to_user_mut(pr(1)).unwrap();
            user.last_activity = time();
            let report = Report {
                confirmed_by: vec![0],
                timestamp: time() - WEEK,
                closed: true,
                ..Default::default()
            };
            user.report = Some(report);
            assert_eq!(
                create_proposal(state, pr(1), post_id, Payload::Noop, time()),
                Err("untrusted account".into())
            );

            // Without reports all works.
            state.principal_to_user_mut(pr(1)).unwrap().report.take();
            assert!(create_proposal(state, pr(1), post_id, Payload::Noop, time()).is_ok())
        })
    }

    #[test]
    #[should_panic(expected = "couldn't take post 2: not found")]
    fn test_wrong_post_id_in_proposal() {
        mutate(|state| {
            create_user(state, pr(1));
            insert_balance(state, pr(1), 1000 * 100);
            state.principal_to_user_mut(pr(1)).unwrap().stalwart = true;
            create_proposal(state, pr(1), 2, Payload::Noop, time()).unwrap();
        })
    }

    #[test]
    #[should_panic(expected = "post cannot have any extensions")]
    fn test_wrong_post_id_in_proposal_2() {
        mutate(|state| {
            create_user(state, pr(1));
            insert_balance(state, pr(1), 1000 * 100);
            state.principal_to_user_mut(pr(1)).unwrap().stalwart = true;
            let post_id = Post::create(
                state,
                "hello world".into(),
                &[],
                pr(1),
                0,
                None,
                None,
                Some(Extension::Proposal(4)),
            )
            .unwrap();
            create_proposal(state, pr(1), post_id, Payload::Noop, time()).unwrap();
        })
    }

    #[test]
    fn test_proposal_canceling() {
        mutate(|state| {
            // create voters, make each of them earn some rewards
            for i in 1..=2 {
                let p = pr(i);
                create_user(state, p);
                insert_balance(state, p, 1000 * 100);
            }

            state.principal_to_user_mut(pr(1)).unwrap().stalwart = true;

            let id = propose(state, pr(1), "test".into(), Payload::Noop, time())
                .expect("couldn't create proposal");

            let id2 = propose(
                state,
                pr(1),
                "test".into(),
                Payload::Funding(
                    Principal::from_text("e3mmv-5qaaa-aaaah-aadma-cai").unwrap(),
                    10,
                ),
                time(),
            )
            .expect("couldn't create proposal");

            assert_eq!(
                state.proposals.get(id2 as usize).unwrap().status,
                Status::Open
            );

            let upgrade_id = propose(
                state,
                pr(1),
                "test".into(),
                Payload::Release(Release {
                    commit: "sdasd".into(),
                    hash: "".into(),
                    binary: vec![1],
                    closed_features: vec![],
                }),
                time(),
            )
            .expect("couldn't create proposal");

            let id3 = propose(
                state,
                pr(1),
                "test".into(),
                Payload::Funding(
                    Principal::from_text("e3mmv-5qaaa-aaaah-aadma-cai").unwrap(),
                    10,
                ),
                time() + 2 * HOUR,
            )
            .expect("couldn't create proposal");

            assert_eq!(
                state.proposals.get(id3 as usize).unwrap().status,
                Status::Open
            );
            assert_eq!(
                state.proposals.get(id2 as usize).unwrap().status,
                Status::Open
            );

            cancel_proposal(state, pr(2), id).unwrap();
            assert_eq!(
                state.proposals.get(id as usize).unwrap().status,
                Status::Open
            );

            cancel_proposal(state, pr(1), id).unwrap();
            assert_eq!(
                state.proposals.get(id as usize).unwrap().status,
                Status::Cancelled
            );

            assert_eq!(
                state.proposals.get(upgrade_id as usize).unwrap().status,
                Status::Open
            );

            let upgrade_id2 = propose(
                state,
                pr(1),
                "test".into(),
                Payload::Release(Release {
                    commit: "sdasd".into(),
                    hash: "".into(),
                    binary: vec![1],
                    closed_features: vec![],
                }),
                time(),
            )
            .expect("couldn't create proposal");

            assert_eq!(
                state.proposals.get(upgrade_id as usize).unwrap().status,
                Status::Cancelled
            );
            assert_eq!(
                state.proposals.get(upgrade_id2 as usize).unwrap().status,
                Status::Open
            );
        });
    }

    #[test]
    fn test_proposal_voting() {
        let data = &"".to_string();
        let proposer = pr(1);
        mutate(|state| {
            state.auction.last_auction_price_e8s = 10;
            state.e8s_for_one_xdr = 10;
            // create voters, make each of them earn some rewards
            for i in 1..11 {
                let p = pr(i);
                create_user(state, p);
                let user = state.principal_to_user_mut(p).unwrap();
                user.last_activity = time();
                insert_balance(state, p, 1000 * 100);
            }

            let token_balance = state.principal_to_user(proposer).unwrap().total_balance();

            // make sure the rewards accounting was correct
            assert_eq!(state.principal_to_user(proposer).unwrap().rewards(), 1000);

            // make sure all got the right amount of minted tokens
            for i in 1..11 {
                let p = pr(i);
                assert_eq!(
                    state.balances.get(&account(p)).copied().unwrap_or_default(),
                    100000,
                )
            }

            state.principal_to_user_mut(proposer).unwrap().stalwart = true;

            // check error cases on voting
            assert_eq!(
                propose(state, pr(111), "".into(), Payload::Noop, 0),
                Err("no user with controller xax2h-iaaaa-aaaaa-aabxq found".to_string())
            );
            assert_eq!(
                propose(state, proposer, "".into(), Payload::Noop, 0),
                Err("invalid post content".to_string())
            );
            let id = propose(state, proposer, "test".into(), Payload::Noop, time()).unwrap();

            // make sure tokens were burned
            let user = state.principal_to_user_mut(proposer).unwrap();
            assert_eq!(
                user.total_balance(),
                token_balance - CONFIG.proposal_escrow_amount_xdr
            );

            assert_eq!(state.proposals.len(), 1);

            let p = state.proposals.iter_mut().next().unwrap();
            p.status = Status::Executed;

            assert_eq!(state.proposals.len(), 1);

            assert_eq!(
                vote_on_proposal(state, time(), proposer, id, false, data),
                Err("last proposal is not open".into())
            );

            // create a new proposal
            let prop_id = propose(state, proposer, "test".into(), Payload::Noop, time()).unwrap();
            // make sure more tokens were burned
            let user = state.principal_to_user_mut(proposer).unwrap();
            assert_eq!(
                user.total_balance(),
                token_balance - 2 * CONFIG.proposal_escrow_amount_xdr
            );

            assert_eq!(state.proposals.len(), 2);

            // vote by non existing user
            assert_eq!(
                vote_on_proposal(state, time(), pr(111), prop_id, false, data),
                Err("no user found".to_string())
            );

            // vote no 3 times
            for i in 1..4 {
                assert!(vote_on_proposal(state, time(), pr(i), prop_id, false, data).is_ok());
                assert_eq!(state.proposals.iter().last().unwrap().status, Status::Open);
            }

            // error cases again
            assert_eq!(
                vote_on_proposal(state, time() + 1, proposer, prop_id, false, data),
                Err("double vote".to_string())
            );

            let p = pr(77);
            state.balances.insert(account(p), 10000000);
            assert_eq!(
                vote_on_proposal(state, time(), p, prop_id, false, data),
                Err("no user found".to_string())
            );

            let user = state.principal_to_user_mut(proposer).unwrap();
            assert_eq!(user.credits(), 1000 - 2 * CONFIG.post_cost);

            assert!(user.stalwart);

            // last rejection and the proposal is rejected
            assert_eq!(
                vote_on_proposal(state, 0, pr(5), prop_id, false, data),
                Ok(())
            );
            assert_eq!(
                state.proposals.iter().last().unwrap().status,
                Status::Rejected,
            );

            // make sure tokens were not minted
            let user = state.principal_to_user_mut(proposer).unwrap();
            assert_eq!(
                user.total_balance(),
                token_balance - 2 * CONFIG.proposal_escrow_amount_xdr
            );
            user.change_credits(100, crate::env::user::CreditsDelta::Plus, "")
                .unwrap();

            // create a new proposal
            user.stalwart = true;

            let prop_id = propose(state, proposer, "test".into(), Payload::Noop, time())
                .expect("couldn't propose");

            // make sure it is executed when 2/3 have voted
            for i in 2..7 {
                assert!(vote_on_proposal(state, time(), pr(i), prop_id, true, data).is_ok());
                assert_eq!(state.proposals.iter().last().unwrap().status, Status::Open);
            }
            assert!(vote_on_proposal(state, time(), pr(7), prop_id, true, data).is_ok());
            assert_eq!(state.proposals.iter().last().unwrap().status, Status::Open);

            assert!(vote_on_proposal(state, time(), pr(8), prop_id, true, data).is_ok());
            assert_eq!(
                state.proposals.iter().last().unwrap().status,
                Status::Executed
            );
            assert_eq!(
                vote_on_proposal(state, time(), pr(9), prop_id, true, data),
                Err("last proposal is not open".into())
            )
        })
    }

    #[test]
    fn test_reducing_voting_power() {
        let data = "";
        mutate(|state| {
            state.auction.last_auction_price_e8s = 10;
            state.e8s_for_one_xdr = 10;
            // create voters, make each of them earn some rewards
            for i in 1..=3 {
                let p = pr(i);
                let id = create_user(state, p);
                // We need to give user 1 slightly more tokens, so that after proposals each
                // controls exactly 33% of voting power.
                insert_balance(
                    state,
                    p,
                    100 * 100
                        + if i == 1 {
                            CONFIG.proposal_escrow_amount_xdr
                        } else {
                            0
                        },
                );
                let user = state.users.get_mut(&id).unwrap();
                user.last_activity = time();
            }
            state.principal_to_user_mut(pr(1)).unwrap().stalwart = true;

            let prop_id = propose(state, pr(1), "test".into(), Payload::Noop, time())
                .expect("couldn't propose");

            assert_eq!(
                vote_on_proposal(state, time(), pr(1), prop_id, false, data),
                Ok(())
            );
            assert_eq!(
                state.proposals.iter().last().unwrap().voting_power,
                10000 * 3
            );

            // after a day we only count 99% of voting power
            assert_eq!(execute_proposal(state, prop_id, time() + HOUR * 24), Ok(()));
            assert_eq!(state.proposals.iter().last().unwrap().voting_power, 29700);
            assert_eq!(state.proposals.iter().last().unwrap().status, Status::Open);

            // after a day we only count 98% of voting power and it's enough to reject
            assert_eq!(
                execute_proposal(state, prop_id, time() + 2 * HOUR * 24),
                Ok(())
            );
            assert_eq!(state.proposals.iter().last().unwrap().voting_power, 29400);

            assert_eq!(
                state.proposals.iter().last().unwrap().status,
                Status::Rejected
            );
        })
    }

    #[test]
    fn test_non_controversial_rejection() {
        mutate(|state| {
            state.auction.last_auction_price_e8s = 10;
            state.e8s_for_one_xdr = 10;
            // create voters, make each of them earn some rewards
            for i in 1..=5 {
                let p = pr(i);
                let id = create_user(state, p);
                insert_balance(state, p, 100 * 100);
                let user = state.users.get_mut(&id).unwrap();
                user.last_activity = time();
            }
            state.principal_to_user_mut(pr(1)).unwrap().stalwart = true;
            let token_balance = state.principal_to_user(pr(1)).unwrap().total_balance();

            let prop_id = propose(state, pr(1), "test".into(), Payload::Noop, time())
                .expect("couldn't propose");

            // Tokens burned.
            assert_eq!(
                state.principal_to_user(pr(1)).unwrap().total_balance(),
                token_balance - CONFIG.proposal_escrow_amount_xdr
            );

            assert!(state.principal_to_user(pr(1)).unwrap().credits() > 0);
            let data = "";
            for i in 1..=3 {
                assert_eq!(
                    vote_on_proposal(state, time(), pr(i), prop_id, true, data),
                    Ok(())
                );
            }
            for i in 4..=5 {
                assert_eq!(
                    vote_on_proposal(state, time(), pr(i), prop_id, false, data),
                    Ok(())
                );
            }

            assert_eq!(
                state.proposals.iter().last().unwrap().status,
                Status::Rejected
            );
            // Tokens were minted.
            assert_eq!(
                state.principal_to_user(pr(1)).unwrap().total_balance(),
                token_balance
            );
        })
    }

    #[test]
    fn test_funding_proposal() {
        mutate(|state| {
            // create voters, make each of them earn some rewards
            for i in 1..=2 {
                let p = pr(i);
                create_user(state, p);
                insert_balance(state, p, (100 * (1 << i)) * 100);
            }
            state.principal_to_user_mut(pr(1)).unwrap().stalwart = true;

            state
                .balances
                .insert(account(pr(222)), CONFIG.maximum_supply);
            assert_eq!(
                propose(
                    state,
                    pr(1),
                    "test".into(),
                    Payload::Rewards(Rewards {
                        receiver: pr(4),
                        submissions: Default::default(),
                        minted: 0,
                    }),
                    time(),
                ),
                Err("no rewards are allowed when the current supply is above maximum".to_string())
            );
            state.balances.remove(&account(pr(222)));

            let prop_id = propose(
                state,
                pr(1),
                "test".into(),
                Payload::Rewards(Rewards {
                    receiver: pr(1),
                    submissions: Default::default(),
                    minted: 0,
                }),
                time(),
            )
            .expect("couldn't propose");

            assert_eq!(
                vote_on_proposal(state, time(), pr(1), prop_id, true, "300"),
                Err("reward receivers can not vote".into())
            );
        })
    }

    #[test]
    fn test_reward_proposal() {
        mutate(|state| {
            state.auction.last_auction_price_e8s = 10;
            state.e8s_for_one_xdr = 10;
            // create voters, make each of them earn some rewards
            for i in 1..=3 {
                let p = pr(i);
                create_user(state, p);
                insert_balance(state, p, (100 * (1 << i)) * 100);
            }
            state.principal_to_user_mut(pr(1)).unwrap().stalwart = true;
            state.principal_to_user_mut(pr(2)).unwrap().stalwart = true;

            // Case 0: max supply reached
            state
                .balances
                .insert(account(pr(222)), CONFIG.maximum_supply);
            assert_eq!(
                propose(
                    state,
                    pr(1),
                    "test".into(),
                    Payload::Rewards(Rewards {
                        receiver: pr(4),
                        submissions: Default::default(),
                        minted: 0,
                    }),
                    time(),
                ),
                Err("no rewards are allowed when the current supply is above maximum".to_string())
            );
            state.balances.remove(&account(pr(222)));

            // Case 1: all agree
            let prop_id = propose(
                state,
                pr(1),
                "test".into(),
                Payload::Rewards(Rewards {
                    receiver: pr(4),
                    submissions: Default::default(),
                    minted: 0,
                }),
                time(),
            )
            .expect("couldn't propose");

            assert_eq!(
                vote_on_proposal(state, time(), pr(1), prop_id, true, "30000"),
                Err("reward amount is higher than the configured maximum of 1000 tokens".into())
            );

            assert_eq!(
                state.active_voting_power(0),
                140000 - CONFIG.proposal_escrow_amount_xdr
            );

            // 200 tokens vote for reward of size 1000
            assert_eq!(
                vote_on_proposal(state, 0, pr(1), prop_id, true, "1000"),
                Ok(())
            );
            // 400 tokens vote for reward of size 200
            assert_eq!(
                vote_on_proposal(state, 0, pr(2), prop_id, true, "200"),
                Ok(())
            );
            // 800 tokens vote for reward of size 500
            assert_eq!(
                vote_on_proposal(state, 0, pr(3), prop_id, true, "500"),
                Ok(())
            );

            let proposal = state.proposals.iter().find(|p| p.id == prop_id).unwrap();
            if let Payload::Rewards(reward) = &proposal.payload {
                assert_eq!(reward.minted, 48287);
                assert_eq!(proposal.status, Status::Executed);
            } else {
                panic!("unexpected payload")
            };

            assert_eq!(state.active_voting_power(0), 140000);

            // Case 2: proposal gets rejected
            let prop_id = propose(
                state,
                pr(1),
                "test".into(),
                Payload::Rewards(Rewards {
                    receiver: pr(111),
                    submissions: Default::default(),
                    minted: 0,
                }),
                time(),
            )
            .expect("couldn't propose");

            assert_eq!(
                vote_on_proposal(state, 0, pr(1), prop_id, true, "30000"),
                Err("reward amount is higher than the configured maximum of 1000 tokens".into())
            );

            // 200 tokens vote for reward of size 1000
            assert_eq!(
                vote_on_proposal(state, 0, pr(1), prop_id, true, "1000"),
                Ok(())
            );
            // 400 tokens vote for reward of size 200
            assert_eq!(
                vote_on_proposal(state, 0, pr(2), prop_id, true, "200"),
                Ok(())
            );
            // 800 tokens reject
            assert_eq!(
                vote_on_proposal(state, 0, pr(3), prop_id, false, ""),
                Ok(())
            );

            let proposal = state.proposals.iter().find(|p| p.id == prop_id).unwrap();
            if let Payload::Rewards(reward) = &proposal.payload {
                assert_eq!(reward.minted, 0);
                assert_eq!(proposal.status, Status::Rejected);
            } else {
                panic!("unexpected payload")
            };

            // Case 3: some voters reject
            let prop_id = propose(
                state,
                pr(1),
                "test".into(),
                Payload::Rewards(Rewards {
                    receiver: pr(111),
                    submissions: Default::default(),
                    minted: 0,
                }),
                time(),
            )
            .expect("couldn't propose");

            assert_eq!(
                vote_on_proposal(state, 0, pr(1), prop_id, true, "30000"),
                Err("reward amount is higher than the configured maximum of 1000 tokens".into())
            );

            // 200 tokens vote for reward of size 1000
            assert_eq!(
                vote_on_proposal(state, 0, pr(1), prop_id, true, "1000"),
                Ok(())
            );
            // 400 tokens reject
            assert_eq!(
                vote_on_proposal(state, 0, pr(2), prop_id, false, "200"),
                Ok(())
            );
            // 800 tokens vote for reward of size 500
            assert_eq!(
                vote_on_proposal(state, 0, pr(3), prop_id, true, "500"),
                Ok(())
            );

            let proposal = state.proposals.iter().find(|p| p.id == prop_id).unwrap();
            if let Payload::Rewards(reward) = &proposal.payload {
                assert_eq!(reward.minted, 42541);
                assert_eq!(proposal.status, Status::Executed);
            } else {
                panic!("unexpected payload")
            };

            // Case 4: user votes for themseleves
            let prop_id = propose(
                state,
                pr(2),
                "test".into(),
                Payload::Rewards(Rewards {
                    receiver: pr(1),
                    submissions: Default::default(),
                    minted: 0,
                }),
                time(),
            )
            .expect("couldn't propose");

            assert_eq!(
                vote_on_proposal(state, 0, pr(1), prop_id, true, "300"),
                Err("reward receivers can not vote".into())
            );
        })
    }

    #[actix_rt::test]
    async fn test_balance_adjustments_on_bulletins() {
        mutate(|state| {
            state.init();
            state.auction.last_auction_price_e8s = 10;
            state.e8s_for_one_xdr = 10;
            let escrow_tokens = state.e8s_for_one_xdr * CONFIG.proposal_escrow_amount_xdr
                / state.auction.last_auction_price_e8s;

            // create voters, make each of them earn some rewards
            for i in 1..=3 {
                let p = pr(i);
                create_user(state, p);
                insert_balance(state, p, (100 * (1 << i)) * 100);
                let user = state.principal_to_user_mut(p).unwrap();
                user.last_activity = time();
            }
            // create one more user
            create_user(state, pr(4));
            let user = state.principal_to_user_mut(pr(4)).unwrap();
            user.last_activity = time();

            // Case 1: all agree
            let prop_id = propose(
                state,
                pr(1),
                "test".into(),
                Payload::Rewards(Rewards {
                    receiver: pr(4),
                    submissions: Default::default(),
                    minted: 0,
                }),
                time(),
            )
            .expect("couldn't propose");

            assert_eq!(state.active_voting_power(time()), 140000 - escrow_tokens);

            // 800 tokens vote for reward of size 500
            assert_eq!(
                vote_on_proposal(state, time(), pr(3), prop_id, true, "500"),
                Ok(())
            );
            // User 3 transfers 600 tokens after voting
            transfer(
                state,
                0,
                pr(3),
                TransferArgs {
                    from_subaccount: None,
                    to: account(pr(4)),
                    amount: 60000,
                    fee: Some(1),
                    memo: None,
                    created_at_time: None,
                },
            )
            .unwrap();
            assert_eq!(
                state.active_voting_power(time()),
                140000 - CONFIG.proposal_escrow_amount_xdr  /* fee */ - 1
            );

            // 200 tokens vote for reward of size 1000
            assert_eq!(
                vote_on_proposal(state, time(), pr(1), prop_id, true, "1000"),
                Ok(())
            );

            // 400 tokens vote for reward of size 200
            assert_eq!(
                vote_on_proposal(state, time(), pr(2), prop_id, true, "200"),
                Ok(())
            );

            let proposal = state.proposals.iter().find(|p| p.id == prop_id).unwrap();
            // Proposal cannot be executed anymore
            if let Payload::Rewards(reward) = &proposal.payload {
                assert_eq!(reward.minted, 0);
                assert_eq!(proposal.status, Status::Open);
            } else {
                panic!("unexpected payload")
            };

            // User 4 transfers all tokens back to user 3.
            transfer(
                state,
                0,
                pr(4),
                TransferArgs {
                    from_subaccount: None,
                    to: account(pr(3)),
                    amount: 60000 - 1,
                    fee: Some(1),
                    memo: None,
                    created_at_time: None,
                },
            )
            .unwrap();
            assert_eq!(
                state.active_voting_power(time()),
                140000 - CONFIG.proposal_escrow_amount_xdr /* fees */ - 1 - 1
            );
        });

        // Simulate daily chores which are routinely trying to execute open proposals.
        State::daily_chores(10000).await;

        read(|state| {
            let proposal = state.proposals.iter().find(|p| p.id == 0).unwrap();
            if let Payload::Rewards(reward) = &proposal.payload {
                assert_eq!(reward.minted, 48287);
                assert_eq!(proposal.status, Status::Executed);
            } else {
                panic!("unexpected payload")
            };
        })
    }
}
