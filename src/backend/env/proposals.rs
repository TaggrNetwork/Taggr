use crate::token::{Account, Token};

use super::config::CONFIG;
use super::user::Predicate;
use super::{time, HOUR};
use super::{user::UserId, State};
use ic_cdk::export::candid::Principal;
use ic_cdk::{api::call::call, id};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Clone, Deserialize, Debug, PartialEq, Serialize)]
pub enum Status {
    Open,
    Rejected,
    Executed,
    Cancelled,
}

impl Default for Status {
    fn default() -> Self {
        Status::Open
    }
}

#[derive(Clone, Default, Serialize, Deserialize)]
pub struct Proposal {
    pub proposer: UserId,
    pub timestamp: u64,
    pub description: String,
    pub status: Status,
    pub payload: Payload,
    votes: Vec<(Principal, bool, Token)>,
    voting_power: Token,
}

impl Proposal {
    fn vote(&mut self, state: &State, principal: Principal, approve: bool) -> Result<(), String> {
        if !state
            .principal_to_user(principal)
            .map(|user| user.trusted())
            .unwrap_or(false)
        {
            return Err("only trusted users can vote".into());
        }
        if self.votes.iter().any(|(voter, _, _)| *voter == principal) {
            return Err("double vote".into());
        }
        let balance = state
            .balances
            .get(&Account {
                owner: principal,
                subaccount: None,
            })
            .ok_or_else(|| "only token holders can vote".to_string())?;

        self.votes.push((principal, approve, *balance));
        Ok(())
    }

    async fn execute(&mut self, state: &mut State, time: u64) -> Result<(), String> {
        let supply_of_users_total: Token = state
            .balances
            .iter()
            .filter_map(|(acc, balance)| state.principal_to_user(acc.owner).map(|_| *balance))
            .sum();
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
            self.votes
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
                state.charge(
                    self.proposer,
                    CONFIG.proposal_rejection_penalty as i64,
                    "proposal rejection penalty",
                )?;
                state
                    .users
                    .get_mut(&self.proposer)
                    .ok_or("user not found")?
                    .change_karma(
                        -(CONFIG.proposal_rejection_penalty as i64),
                        "proposal rejection penalty",
                    );
            }
            return Ok(());
        }

        if approvals * 100 >= voting_power * CONFIG.proposal_approval_threshold as u64 {
            match &self.payload {
                Payload::Release(release) => {
                    deploy_release(state, &self.description, release).await?;
                }
                Payload::SetController(controller) => {
                    let principal = Principal::from_text(controller).map_err(|e| e.to_string())?;
                    add_controller(principal).await?;
                    state.logger.info(format!(
                        "`{}` was added as a controller of the main cansiter via proposal execution.",
                        principal
                    ));
                }
                Payload::Fund(receiver, tokens) => {
                    let receiver = Principal::from_text(receiver).map_err(|e| e.to_string())?;
                    crate::token::mint(
                        state,
                        Account {
                            owner: receiver,
                            subaccount: None,
                        },
                        *tokens * 10_u64.pow(CONFIG.token_decimals as u32),
                    );
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
                }
                _ => {}
            }
            self.status = Status::Executed;
        }

        Ok(())
    }
}

#[derive(Clone, Serialize, Deserialize)]
pub enum Payload {
    Noop,
    Release(Release),
    SetController(String),
    Fund(String, Token),
}

impl Default for Payload {
    fn default() -> Self {
        Payload::Noop
    }
}

impl Payload {
    fn validate(&mut self) -> Result<(), String> {
        match self {
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
            Payload::SetController(controller) => {
                Principal::from_text(controller).map_err(|err| err.to_string())?;
            }
            Payload::Fund(controller, tokens) => {
                Principal::from_text(controller).map_err(|err| err.to_string())?;
                if *tokens > CONFIG.max_funding_amount {
                    return Err(format!(
                        "funding amount higher than the configured maximum of {} tokens",
                        CONFIG.max_funding_amount
                    ));
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
) -> Result<(), String> {
    let user = state.principal_to_user(caller).ok_or("user not found")?;
    if !user.stalwart {
        return Err("only stalwarts can create proposals".to_string());
    }
    if description.is_empty() {
        return Err("description is empty".to_string());
    }
    payload.validate()?;
    let proposer = user.id;
    let proposer_name = user.name.clone();
    // invalidate all previous proposals
    state
        .proposals
        .iter_mut()
        .filter(|p| p.status == Status::Open)
        .for_each(|proposal| {
            proposal.status = Status::Cancelled;
        });
    state.proposals.push(Proposal {
        description,
        proposer,
        timestamp: time(),
        status: Status::Open,
        payload,
        votes: Default::default(),
        voting_power: 0,
    });
    let msg = format!(
        "New [proposal](#/proposals) was submitted by @{} 🎈",
        &proposer_name
    );
    state.notify_with_predicate(
        &|user| user.active_within_weeks(time(), 1) && user.balance > 0,
        format!("{} Please vote!", &msg),
        Predicate::ProposalPending,
    );
    state.logger.info(msg);
    Ok(())
}

pub async fn vote_on_last_proposal(
    state: &mut State,
    time: u64,
    caller: Principal,
    approved: bool,
) -> Result<(), String> {
    let mut proposal = state
        .proposals
        .pop()
        .ok_or_else(|| "no proposals founds".to_string())?;
    if proposal.status != Status::Open {
        state.proposals.push(proposal);
        return Err("last proposal is not open".into());
    }
    if let Err(err) = proposal.vote(state, caller, approved) {
        state.proposals.push(proposal);
        return Err(err);
    }
    if let Some(user) = state.principal_to_user(caller) {
        state.spend_to_user_karma(user.id, CONFIG.voting_reward, "voting rewards");
    }
    state.proposals.push(proposal);
    execute_last_proposal(state, time).await
}

pub fn cancel_last_proposal(state: &mut State, caller: Principal) {
    let mut proposal = state.proposals.pop().expect("no proposals exists");
    let user = state.principal_to_user(caller).expect("no user found");
    if proposal.status == Status::Open && proposal.proposer == user.id {
        proposal.status = Status::Cancelled;
    }
    state.proposals.push(proposal);
}

pub(super) async fn execute_last_proposal(state: &mut State, time: u64) -> Result<(), String> {
    let mut proposal = state
        .proposals
        .pop()
        .ok_or_else(|| "no proposals founds".to_string())?;
    if proposal.status != Status::Open {
        state.proposals.push(proposal);
        return Err("last proposal is not open".into());
    }
    let previous_state = proposal.status.clone();
    let result = proposal.execute(state, time).await;
    if previous_state != proposal.status {
        state.denotify_users(&|user| user.active_within_weeks(time, 1) && user.balance > 0);
    }
    state.proposals.push(proposal);
    result
}

#[derive(Clone, Deserialize, Serialize)]
pub struct Release {
    pub commit: String,
    pub hash: String,
    #[serde(skip)]
    pub binary: Vec<u8>,
}

async fn deploy_release(
    state: &mut State,
    description: &str,
    release: &Release,
) -> Result<(), String> {
    if state.upgrader_canister_id.is_none() {
        create_upgrader(state).await?;
    }
    let (_,): ((),) = call(
        state.upgrader_canister_id.expect("no upgrader cansiter"),
        "deploy_release",
        (release.binary.clone(),),
    )
    .await
    .map_err(|err| format!("couldn't deploy release to upgrader: {:?}", err))?;
    state
        .logger
        .info(format!("Deploying release `{}`...", &release.hash[..8]));

    if !description.contains("#chore") {
        state.notify_users(
            &|user| user.active_within_weeks(time(), 1),
            format!(
                "New release `{}` [was deployed](#/proposals).",
                &release.hash[..8]
            ),
        );
    }
    Ok(())
}

async fn create_upgrader(state: &mut State) -> Result<(), String> {
    let upgrader_id = canisters::new().await?;
    state.upgrader_canister_id = Some(upgrader_id);
    state
        .logger
        .info(format!("Upgrader canister `{upgrader_id}` created."));
    let upgrader_wasm =
        include_bytes!("../../../target/wasm32-unknown-unknown/release/upgrader.wasm.gz");
    canisters::install(
        upgrader_id,
        upgrader_wasm.to_vec(),
        canisters::CanisterInstallMode::Install,
    )
    .await?;
    add_controller(upgrader_id).await?;
    state.logger.info("Upgrader WASM installed.");
    Err(format!(
        "No upgrader canister was found and new one was created ({}). Please try again.",
        upgrader_id
    ))
}

async fn add_controller(controller: Principal) -> Result<(), String> {
    let canister_id = id();
    let mut controllers = canisters::settings(canister_id).await?.settings.controllers;
    controllers.push(controller);
    canisters::set_controllers(canister_id, controllers).await
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::*;
    use crate::env::tests::{create_user, pr};

    #[actix_rt::test]
    async fn test_proposal_canceling() {
        let mut state = State::default();

        // create voters, make each of them earn some karma
        for i in 1..=2 {
            let p = pr(i);
            let id = create_user(&mut state, p);
            let user = state.users.get_mut(&id).unwrap();
            user.change_karma(1000, "test");
            assert_eq!(user.karma(), CONFIG.trusted_user_min_karma);
            assert!(user.trusted());
        }

        assert_eq!(
            propose(&mut state, pr(1), "test".into(), Payload::Noop),
            Err("only stalwarts can create proposals".into())
        );
        state.principal_to_user_mut(pr(1)).unwrap().stalwart = true;
        assert_eq!(
            propose(&mut state, pr(1), "test".into(), Payload::Noop),
            Ok(())
        );

        cancel_last_proposal(&mut state, pr(2));
        assert_eq!(state.proposals.first().unwrap().status, Status::Open);

        cancel_last_proposal(&mut state, pr(1));
        assert_eq!(state.proposals.first().unwrap().status, Status::Cancelled);
    }

    #[actix_rt::test]
    async fn test_proposal_voting() {
        let mut state = State::default();

        // create voters, make each of them earn some karma
        let mut eligigble = HashSet::new();
        for i in 1..11 {
            let p = pr(i);
            let id = create_user(&mut state, p);
            eligigble.insert(id);
            let user = state.users.get_mut(&id).unwrap();
            user.change_karma(1000, "test");
            assert_eq!(user.karma(), CONFIG.trusted_user_min_karma);
            assert!(user.trusted());
        }

        // mint tokens
        state.mint(eligigble);
        assert_eq!(state.ledger.len(), 10);

        // make sure the karma accounting was correct
        assert_eq!(
            state.principal_to_user(pr(1)).unwrap().karma_to_reward(),
            1000_i64
        );
        assert_eq!(
            state.principal_to_user(pr(1)).unwrap().karma(),
            CONFIG.trusted_user_min_karma
        );

        // make sure all got the right amount of minted tokens
        for i in 1..11 {
            let p = pr(i);
            assert_eq!(
                state
                    .balances
                    .get(&Account {
                        owner: p,
                        subaccount: None
                    })
                    .copied()
                    .unwrap_or_default(),
                100000
            )
        }

        state.principal_to_user_mut(pr(1)).unwrap().stalwart = true;

        // check error cases on voting
        assert_eq!(
            propose(&mut state, pr(111), "".into(), Payload::Noop),
            Err("user not found".to_string())
        );
        assert_eq!(
            propose(&mut state, pr(1), "".into(), Payload::Noop),
            Err("description is empty".to_string())
        );
        assert_eq!(
            propose(&mut state, pr(1), "test".into(), Payload::Noop),
            Ok(())
        );
        assert_eq!(state.proposals.len(), 1);

        let p = state.proposals.iter_mut().next().unwrap();
        p.status = Status::Executed;

        assert_eq!(state.proposals.len(), 1);

        assert_eq!(
            vote_on_last_proposal(&mut state, 0, pr(1), false).await,
            Err("last proposal is not open".into())
        );

        // create a new proposal
        assert_eq!(
            propose(&mut state, pr(1), "test".into(), Payload::Noop),
            Ok(())
        );

        assert_eq!(state.proposals.len(), 2);

        // vote by non existing user
        assert_eq!(
            vote_on_last_proposal(&mut state, 0, pr(111), false).await,
            Err("only trusted users can vote".to_string())
        );
        let id = create_user(&mut state, pr(111));
        assert!(state.users.get(&id).unwrap().trusted());
        assert_eq!(
            vote_on_last_proposal(&mut state, 0, pr(111), false).await,
            Err("only token holders can vote".to_string())
        );

        // vote no 3 times
        for i in 1..4 {
            assert!(vote_on_last_proposal(&mut state, 0, pr(i), false)
                .await
                .is_ok());
            assert_eq!(state.proposals.iter().last().unwrap().status, Status::Open);
        }

        // error cases again
        let proposer = pr(1);
        assert_eq!(
            vote_on_last_proposal(&mut state, 0, proposer, false).await,
            Err("double vote".to_string())
        );

        let p = pr(77);
        state.balances.insert(
            Account {
                owner: p,
                subaccount: None,
            },
            10000000,
        );
        assert_eq!(
            vote_on_last_proposal(&mut state, 0, p, false).await,
            Err("only trusted users can vote".to_string())
        );

        // adjust karma so that after the proposal is rejected, the user turns into an untrusted
        // one
        let user = state.principal_to_user_mut(proposer).unwrap();
        user.apply_rewards();
        user.change_karma(-100, "");
        assert_eq!(
            user.karma(),
            1000 - 100 + CONFIG.trusted_user_min_karma + CONFIG.voting_reward
        );
        assert_eq!(user.cycles(), 1000);

        // last rejection and the proposal is rejected
        assert!(vote_on_last_proposal(&mut state, 0, pr(5), false)
            .await
            .is_ok(),);
        assert_eq!(
            state.proposals.iter().last().unwrap().status,
            Status::Rejected,
        );

        // make sure the user was penalized
        let user = state.principal_to_user_mut(proposer).unwrap();
        assert_eq!(
            user.karma(),
            1000 - 100 + CONFIG.trusted_user_min_karma - CONFIG.proposal_rejection_penalty as i64
                + CONFIG.voting_reward
        );
        assert_eq!(
            user.cycles(),
            1000 - CONFIG.proposal_rejection_penalty as i64
        );
        assert!(!user.trusted());

        // create a new proposal
        assert_eq!(
            propose(&mut state, pr(1), "test".into(), Payload::Noop),
            Ok(())
        );

        assert_eq!(
            vote_on_last_proposal(&mut state, 0, pr(1), true).await,
            Err("only trusted users can vote".into())
        );

        // make sure it is executed when 2/3 have voted
        for i in 2..7 {
            assert!(vote_on_last_proposal(&mut state, 0, pr(i), true)
                .await
                .is_ok());
            assert_eq!(state.proposals.iter().last().unwrap().status, Status::Open);
        }
        assert!(vote_on_last_proposal(&mut state, 0, pr(7), true)
            .await
            .is_ok());
        assert_eq!(state.proposals.iter().last().unwrap().status, Status::Open);

        assert!(vote_on_last_proposal(&mut state, 0, pr(8), true)
            .await
            .is_ok());
        assert_eq!(
            state.proposals.iter().last().unwrap().status,
            Status::Executed
        );
        assert_eq!(
            vote_on_last_proposal(&mut state, 0, pr(9), true).await,
            Err("last proposal is not open".into())
        )
    }

    #[actix_rt::test]
    async fn test_reducing_voting_power() {
        let mut state = State::default();

        // create voters, make each of them earn some karma
        let mut eligigble = HashSet::new();
        for i in 1..=3 {
            let p = pr(i);
            let id = create_user(&mut state, p);
            eligigble.insert(id);
            let user = state.users.get_mut(&id).unwrap();
            user.change_karma(100, "test");
            assert_eq!(user.karma(), CONFIG.trusted_user_min_karma);
        }
        state.principal_to_user_mut(pr(1)).unwrap().stalwart = true;

        // mint tokens
        state.mint(eligigble);

        assert_eq!(
            propose(&mut state, pr(1), "test".into(), Payload::Noop),
            Ok(())
        );
        assert_eq!(
            vote_on_last_proposal(&mut state, time(), pr(1), false).await,
            Ok(())
        );
        assert_eq!(
            state.proposals.iter().last().unwrap().voting_power,
            10000 * 3
        );

        // after a day we only count 99% of voting power
        assert_eq!(
            execute_last_proposal(&mut state, time() + HOUR * 24).await,
            Ok(())
        );
        assert_eq!(state.proposals.iter().last().unwrap().voting_power, 29700);
        assert_eq!(state.proposals.iter().last().unwrap().status, Status::Open);

        // after a day we only count 98% of voting power and it's enough to reject
        assert_eq!(
            execute_last_proposal(&mut state, time() + 2 * HOUR * 24).await,
            Ok(())
        );
        assert_eq!(state.proposals.iter().last().unwrap().voting_power, 29400);
        assert_eq!(
            state.proposals.iter().last().unwrap().status,
            Status::Rejected
        );
    }

    #[actix_rt::test]
    async fn test_non_controversial_rejection() {
        let mut state = State::default();

        // create voters, make each of them earn some karma
        let mut eligigble = HashSet::new();
        for i in 1..=5 {
            let p = pr(i);
            let id = create_user(&mut state, p);
            eligigble.insert(id);
            let user = state.users.get_mut(&id).unwrap();
            user.change_karma(100, "test");
            assert_eq!(user.karma(), CONFIG.trusted_user_min_karma);
        }
        state.principal_to_user_mut(pr(1)).unwrap().stalwart = true;

        // mint tokens
        state.mint(eligigble);

        assert_eq!(
            propose(&mut state, pr(1), "test".into(), Payload::Noop),
            Ok(())
        );

        assert!(state.principal_to_user(pr(1)).unwrap().cycles() > 0);
        let proposer = state.principal_to_user(pr(1)).unwrap();
        let proposers_karma = proposer.karma() + proposer.karma_to_reward();
        for i in 2..4 {
            assert_eq!(
                vote_on_last_proposal(&mut state, time(), pr(i), false).await,
                Ok(())
            );
        }

        assert_eq!(
            state.proposals.iter().last().unwrap().status,
            Status::Rejected
        );
        assert!(state.principal_to_user(pr(1)).unwrap().cycles() == 0);
        assert_eq!(
            state.principal_to_user(pr(1)).unwrap().karma(),
            proposers_karma - CONFIG.proposal_rejection_penalty as i64
        );
    }
}
