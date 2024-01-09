use super::config::CONFIG;
use super::post::{Extension, Post, PostId};
use super::token::{self, account};
use super::user::Predicate;
use super::{invoices, HOUR};
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

#[derive(Clone, Deserialize, Serialize)]
pub struct Release {
    pub commit: String,
    pub hash: String,
    #[serde(skip)]
    pub binary: Vec<u8>,
}

type ProposedReward = Token;

#[derive(Clone, Deserialize, Serialize)]
pub struct Reward {
    pub receiver: String,
    pub votes: Vec<(Token, ProposedReward)>,
    pub minted: Token,
}

#[derive(Clone, Default, Serialize, Deserialize)]
pub enum Payload {
    #[default]
    Noop,
    Release(Release),
    Fund(String, Token),
    ICPTransfer(AccountIdentifier, Tokens),
    Reward(Reward),
    AddRealmController(String, UserId),
}

#[derive(Clone, Default, Serialize, Deserialize)]
pub struct Proposal {
    pub id: u32,
    pub proposer: UserId,
    pub timestamp: u64,
    pub post_id: PostId,
    pub status: Status,
    pub payload: Payload,
    pub bulletins: Vec<(UserId, bool, Token)>,
    pub voting_power: Token,
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
        let balance = user.total_balance(state);
        if balance == 0 {
            return Err("only token holders can vote".into());
        }

        match &mut self.payload {
            Payload::Release(release) => {
                if approve && release.hash != data {
                    return Err("wrong hash".into());
                }
            }
            Payload::Fund(receiver, _) => {
                if Principal::from_text(receiver) == Ok(principal) {
                    return Err("funding receivers can not vote".into());
                }
            }
            Payload::Reward(Reward {
                receiver, votes, ..
            }) => {
                if Principal::from_text(receiver) == Ok(principal) {
                    return Err("reward receivers can not vote".into());
                }
                let minting_ratio = state.minting_ratio();
                let base = token::base();
                let max_funding_amount = CONFIG.max_funding_amount / minting_ratio / base;
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
                votes.push((balance, tokens * base))
            }
            _ => {}
        }

        self.bulletins.push((user.id, approve, balance));
        Ok(())
    }

    fn execute(&mut self, state: &mut State, time: u64) -> Result<(), String> {
        let supply_of_users_total = state.active_voting_power(time);
        // decrease the total number according to the delay
        let delay =
            ((100 - (time.saturating_sub(self.timestamp) / (HOUR * 24))).max(1)) as f64 / 100.0;
        let voting_power = (supply_of_users_total as f64 * delay) as u64;
        if self.voting_power > 0 && self.voting_power > voting_power {
            state.logger.info(format!(
                "Decreasing the total voting power on latest proposal from `{}` to `{}`.",
                self.voting_power, voting_power
            ));
        }
        self.voting_power = voting_power;

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

        if rejects * 100 >= voting_power * (100 - CONFIG.proposal_approval_threshold) as u64 {
            self.status = Status::Rejected;
            // if proposal was rejected without a controversion, penalize the proposer
            if approvals * 100 < CONFIG.proposal_controversy_threashold as u64 * rejects {
                let proposer = state
                    .users
                    .get_mut(&self.proposer)
                    .ok_or("user not found")?;
                proposer.stalwart = false;
                proposer.active_weeks = 0;
                proposer.change_rewards(
                    -(CONFIG.proposal_rejection_penalty as i64),
                    "proposal rejection penalty",
                );
                let credit_balance = proposer.credits();
                state.charge(
                    self.proposer,
                    credit_balance.min(CONFIG.proposal_rejection_penalty),
                    "proposal rejection penalty",
                )?;
            }
            return Ok(());
        }

        if approvals * 100 >= voting_power * CONFIG.proposal_approval_threshold as u64 {
            match &mut self.payload {
                Payload::Fund(receiver, tokens) => mint_tokens(state, receiver, *tokens)?,
                Payload::Reward(reward) => {
                    let total: Token = reward.votes.iter().map(|(vp, _)| vp).sum();
                    let tokens_to_mint: Token =
                        reward.votes.iter().fold(0.0, |acc, (vp, reward)| {
                            acc + *vp as f32 / total as f32 * *reward as f32
                        }) as Token;
                    mint_tokens(state, &reward.receiver, tokens_to_mint)?;
                    reward.votes.clear();
                    reward.minted = tokens_to_mint;
                }
                Payload::AddRealmController(realm_id, user_id) => {
                    if let Some(realm) = state.realms.get_mut(realm_id) {
                        realm.controllers.insert(*user_id);
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
        }

        Ok(())
    }
}

fn mint_tokens(state: &mut State, receiver: &str, mut tokens: Token) -> Result<(), String> {
    let receiver = Principal::from_text(receiver).map_err(|e| e.to_string())?;
    crate::token::mint(state, account(receiver), tokens);
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
    fn validate(&mut self, state: &State) -> Result<(), String> {
        let minting_ratio = state.minting_ratio();
        let current_supply: Token = state.balances.values().sum();
        match self {
            Payload::AddRealmController(realm_id, user_id) => {
                if !state.users.contains_key(user_id) {
                    return Err("user not found".to_string());
                }
                if !state.realms.contains_key(realm_id) {
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
                let mut hasher = Sha256::new();
                hasher.update(&release.binary);
                release.hash = format!("{:x}", hasher.finalize());
            }
            Payload::Fund(controller, tokens) => {
                Principal::from_text(controller).map_err(|err| err.to_string())?;
                if current_supply >= CONFIG.maximum_supply {
                    return Err(
                        "no funding is allowed when the curent supply is above maximum".into(),
                    );
                }
                let max_funding_amount = CONFIG.max_funding_amount / minting_ratio;
                if *tokens > max_funding_amount {
                    return Err(format!(
                        "funding amount is higher than the configured maximum of {} tokens",
                        max_funding_amount
                    ));
                }
            }
            Payload::Reward(_) => {
                if current_supply >= CONFIG.maximum_supply {
                    return Err(
                        "no funding is allowed when the curent supply is above maximum".into(),
                    );
                }
            }
            _ => {}
        }
        Ok(())
    }
}

pub fn propose(
    state: &mut State,
    caller: Principal,
    description: String,
    mut payload: Payload,
    time: u64,
) -> Result<u32, String> {
    payload.validate(state)?;
    let user = state
        .principal_to_user_mut(caller)
        .ok_or("proposer user not found")?;
    if !user.stalwart {
        return Err("only stalwarts can create proposals".to_string());
    }
    if description.is_empty() {
        return Err("description is empty".to_string());
    }
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

    let id = state.proposals.len() as u32;

    let post_id = Post::create(
        state,
        description,
        Default::default(),
        caller,
        time,
        None,
        Some(CONFIG.dao_realm.to_owned()),
        Some(Extension::Proposal(id)),
    )?;

    state.proposals.push(Proposal {
        post_id,
        proposer,
        timestamp: time,
        status: Status::Open,
        payload,
        bulletins: Vec::default(),
        voting_power: 0,
        id,
    });
    state.notify_with_predicate(
        &|user| user.active_within_weeks(time, 1) && user.balance > 0,
        format!("@{} submitted a new proposal", &proposer_name,),
        Predicate::Proposal(post_id),
    );
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

pub fn cancel_proposal(state: &mut State, caller: Principal, proposal_id: u32) {
    let mut proposals = std::mem::take(&mut state.proposals);
    let proposal = proposals
        .get_mut(proposal_id as usize)
        .expect("no proposals founds");
    let user = state.principal_to_user(caller).expect("no user found");
    if proposal.status == Status::Open && proposal.proposer == user.id {
        proposal.status = Status::Cancelled;
    }
    state.proposals = proposals;
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
mod tests {

    use super::*;
    use crate::{
        env::{
            tests::{create_user, insert_balance, pr},
            time,
        },
        STATE,
    };

    #[test]
    fn test_proposal_canceling() {
        STATE.with(|cell| {
            cell.replace(Default::default());
            let state = &mut *cell.borrow_mut();

            // create voters, make each of them earn some karma
            for i in 1..=2 {
                let p = pr(i);
                let id = create_user(state, p);
                let user = state.users.get_mut(&id).unwrap();
                user.change_rewards(1000, "test");
            }

            assert_eq!(
                propose(state, pr(1), "test".into(), Payload::Noop, 0),
                Err("only stalwarts can create proposals".into())
            );

            state.principal_to_user_mut(pr(1)).unwrap().stalwart = true;

            let id = propose(state, pr(1), "test".into(), Payload::Noop, 0)
                .expect("couldn't create proposal");

            let id2 = propose(
                state,
                pr(1),
                "test".into(),
                Payload::Fund("e3mmv-5qaaa-aaaah-aadma-cai".into(), 10),
                0,
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
                }),
                0,
            )
            .expect("couldn't create proposal");

            let id3 = propose(
                state,
                pr(1),
                "test".into(),
                Payload::Fund("e3mmv-5qaaa-aaaah-aadma-cai".into(), 10),
                2 * HOUR,
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

            cancel_proposal(state, pr(2), id);
            assert_eq!(
                state.proposals.get(id as usize).unwrap().status,
                Status::Open
            );

            cancel_proposal(state, pr(1), id);
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
                }),
                0,
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
        STATE.with(|cell| {
            cell.replace(Default::default());
            let state = &mut *cell.borrow_mut();

            // create voters, make each of them earn some karma
            for i in 1..11 {
                let p = pr(i);
                let id = create_user(state, p);
                let user = state.users.get_mut(&id).unwrap();
                user.change_rewards(1000, "test");
                insert_balance(state, p, 1000 * 100);
            }

            // make sure the karma accounting was correct
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
                Err("proposer user not found".to_string())
            );
            assert_eq!(
                propose(state, proposer, "".into(), Payload::Noop, 0),
                Err("description is empty".to_string())
            );
            let id = propose(state, proposer, "test".into(), Payload::Noop, 0)
                .expect("couldn't create proposal");

            assert_eq!(state.proposals.len(), 1);

            let p = state.proposals.iter_mut().next().unwrap();
            p.status = Status::Executed;

            assert_eq!(state.proposals.len(), 1);

            assert_eq!(
                vote_on_proposal(state, 0, proposer, id, false, data),
                Err("last proposal is not open".into())
            );

            // create a new proposal
            let prop_id = propose(state, proposer, "test".into(), Payload::Noop, 0)
                .expect("couldn't create proposal");

            assert_eq!(state.proposals.len(), 2);

            // vote by non existing user
            assert_eq!(
                vote_on_proposal(state, 0, pr(111), prop_id, false, data),
                Err("no user found".to_string())
            );

            // vote no 3 times
            for i in 1..4 {
                assert!(vote_on_proposal(state, 0, pr(i), prop_id, false, data).is_ok());
                assert_eq!(state.proposals.iter().last().unwrap().status, Status::Open);
            }

            // error cases again
            assert_eq!(
                vote_on_proposal(state, 1, proposer, prop_id, false, data),
                Err("double vote".to_string())
            );

            let p = pr(77);
            state.balances.insert(account(p), 10000000);
            assert_eq!(
                vote_on_proposal(state, 0, p, prop_id, false, data),
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

            // make sure the user was penalized
            let user = state.principal_to_user_mut(proposer).unwrap();
            assert_eq!(
                user.rewards(),
                1000 - CONFIG.proposal_rejection_penalty as i64
            );
            assert_eq!(
                user.credits(),
                1000 - CONFIG.proposal_rejection_penalty - 2 * CONFIG.post_cost
            );
            assert!(!user.stalwart);
            user.change_credits(100, crate::env::user::CreditsDelta::Plus, "")
                .unwrap();

            // create a new proposal
            user.stalwart = true;
            user.change_rewards(-1000, "");

            let prop_id = propose(state, proposer, "test".into(), Payload::Noop, 0)
                .expect("couldn't propose");

            // make sure it is executed when 2/3 have voted
            for i in 2..7 {
                assert!(vote_on_proposal(state, 0, pr(i), prop_id, true, data).is_ok());
                assert_eq!(state.proposals.iter().last().unwrap().status, Status::Open);
            }
            assert!(vote_on_proposal(state, 0, pr(7), prop_id, true, data).is_ok());
            assert_eq!(state.proposals.iter().last().unwrap().status, Status::Open);

            assert!(vote_on_proposal(state, 0, pr(8), prop_id, true, data).is_ok());
            assert_eq!(
                state.proposals.iter().last().unwrap().status,
                Status::Executed
            );
            assert_eq!(
                vote_on_proposal(state, 0, pr(9), prop_id, true, data),
                Err("last proposal is not open".into())
            )
        })
    }

    #[test]
    fn test_reducing_voting_power() {
        let data = &"".to_string();
        STATE.with(|cell| {
            cell.replace(Default::default());
            let state = &mut *cell.borrow_mut();

            // create voters, make each of them earn some karma
            for i in 1..=3 {
                let p = pr(i);
                let id = create_user(state, p);
                insert_balance(state, p, 100 * 100);
                let user = state.users.get_mut(&id).unwrap();
                user.change_rewards(100, "test");
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
        STATE.with(|cell| {
            cell.replace(Default::default());
            let state = &mut *cell.borrow_mut();

            // create voters, make each of them earn some karma
            for i in 1..=5 {
                let p = pr(i);
                let id = create_user(state, p);
                insert_balance(state, p, 100 * 100);
                let user = state.users.get_mut(&id).unwrap();
                user.change_rewards(100, "test");
            }
            state.principal_to_user_mut(pr(1)).unwrap().stalwart = true;

            let prop_id =
                propose(state, pr(1), "test".into(), Payload::Noop, 0).expect("couldn't propose");

            assert!(state.principal_to_user(pr(1)).unwrap().credits() > 0);
            let proposer = state.principal_to_user(pr(1)).unwrap();
            let data = &"".to_string();
            let rewards = proposer.rewards();
            for i in 2..4 {
                assert_eq!(
                    vote_on_proposal(state, time(), pr(i), prop_id, false, data),
                    Ok(())
                );
            }

            assert_eq!(
                state.proposals.iter().last().unwrap().status,
                Status::Rejected
            );
            assert_eq!(state.principal_to_user(pr(1)).unwrap().credits(), 498);
            assert_eq!(
                state.principal_to_user(pr(1)).unwrap().rewards(),
                rewards - CONFIG.proposal_rejection_penalty as i64
            );
        })
    }

    #[test]
    fn test_funding_proposal() {
        STATE.with(|cell| {
            cell.replace(Default::default());
            let state = &mut *cell.borrow_mut();

            // create voters, make each of them earn some karma
            for i in 1..=2 {
                let p = pr(i);
                let id = create_user(state, p);
                let user = state.users.get_mut(&id).unwrap();
                user.change_rewards(100 * (1 << i), "test");
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
                    Payload::Reward(Reward {
                        receiver: pr(4).to_string(),
                        votes: Default::default(),
                        minted: 0,
                    }),
                    time(),
                ),
                Err("no funding is allowed when the curent supply is above maximum".to_string())
            );
            state.balances.remove(&account(pr(222)));

            let prop_id = propose(
                state,
                pr(1),
                "test".into(),
                Payload::Reward(Reward {
                    receiver: pr(1).to_string(),
                    votes: Default::default(),
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
        STATE.with(|cell| {
            cell.replace(Default::default());
            let state = &mut *cell.borrow_mut();

            // create voters, make each of them earn some karma
            for i in 1..=3 {
                let p = pr(i);
                let id = create_user(state, p);
                insert_balance(state, p, (100 * (1 << i)) * 100);
                let user = state.users.get_mut(&id).unwrap();
                user.change_rewards(100 * (1 << i), "test");
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
                    Payload::Reward(Reward {
                        receiver: pr(4).to_string(),
                        votes: Default::default(),
                        minted: 0,
                    }),
                    time(),
                ),
                Err("no funding is allowed when the curent supply is above maximum".to_string())
            );
            state.balances.remove(&account(pr(222)));

            // Case 1: all agree
            let prop_id = propose(
                state,
                pr(1),
                "test".into(),
                Payload::Reward(Reward {
                    receiver: pr(4).to_string(),
                    votes: Default::default(),
                    minted: 0,
                }),
                time(),
            )
            .expect("couldn't propose");

            assert_eq!(
                vote_on_proposal(state, time(), pr(1), prop_id, true, "30000"),
                Err("reward amount is higher than the configured maximum of 10000 tokens".into())
            );

            assert_eq!(state.active_voting_power(time()), 140000);

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
            // 800 tokens vote for reward of size 500
            assert_eq!(
                vote_on_proposal(state, time(), pr(3), prop_id, true, "500"),
                Ok(())
            );

            let proposal = state.proposals.iter().find(|p| p.id == prop_id).unwrap();
            if let Payload::Reward(reward) = &proposal.payload {
                assert_eq!(reward.minted, 48571);
                assert_eq!(proposal.status, Status::Executed);
            } else {
                panic!("unexpected payload")
            };

            assert_eq!(state.active_voting_power(time()), 140000);

            // Case 2: proposal gets rejected
            let prop_id = propose(
                state,
                pr(1),
                "test".into(),
                Payload::Reward(Reward {
                    receiver: pr(111).to_string(),
                    votes: Default::default(),
                    minted: 0,
                }),
                time(),
            )
            .expect("couldn't propose");

            assert_eq!(
                vote_on_proposal(state, time(), pr(1), prop_id, true, "30000"),
                Err("reward amount is higher than the configured maximum of 10000 tokens".into())
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
            // 800 tokens reject
            assert_eq!(
                vote_on_proposal(state, time(), pr(3), prop_id, false, ""),
                Ok(())
            );

            let proposal = state.proposals.iter().find(|p| p.id == prop_id).unwrap();
            if let Payload::Reward(reward) = &proposal.payload {
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
                Payload::Reward(Reward {
                    receiver: pr(111).to_string(),
                    votes: Default::default(),
                    minted: 0,
                }),
                time(),
            )
            .expect("couldn't propose");

            assert_eq!(
                vote_on_proposal(state, time(), pr(1), prop_id, true, "30000"),
                Err("reward amount is higher than the configured maximum of 10000 tokens".into())
            );

            // 200 tokens vote for reward of size 1000
            assert_eq!(
                vote_on_proposal(state, time(), pr(1), prop_id, true, "1000"),
                Ok(())
            );
            // 400 tokens reject
            assert_eq!(
                vote_on_proposal(state, time(), pr(2), prop_id, false, "200"),
                Ok(())
            );
            // 800 tokens vote for reward of size 500
            assert_eq!(
                vote_on_proposal(state, time(), pr(3), prop_id, true, "500"),
                Ok(())
            );

            let proposal = state.proposals.iter().find(|p| p.id == prop_id).unwrap();
            if let Payload::Reward(reward) = &proposal.payload {
                assert_eq!(reward.minted, 42857);
                assert_eq!(proposal.status, Status::Executed);
            } else {
                panic!("unexpected payload")
            };

            // Case 4: user votes for themseleves
            let prop_id = propose(
                state,
                pr(2),
                "test".into(),
                Payload::Reward(Reward {
                    receiver: pr(1).to_string(),
                    votes: Default::default(),
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
}
