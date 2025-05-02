use crate::env::canisters::{call_canister, call_canister_raw};
use crate::env::config::CONFIG;
use crate::post::{Extension, Poll, Post};
use crate::{env::NeuronId, id, mutate, read};
use candid::CandidType;
use ic_ledger_types::MAINNET_GOVERNANCE_CANISTER_ID;
use serde::{Deserialize, Serialize};

pub enum NNSVote {
    Adopt = 1,
    Reject = 2,
}

#[derive(Serialize, Deserialize)]
pub struct NNSProposal {
    pub id: u64,
    pub topic: i32,
    pub proposer: u64,
    pub title: String,
    pub summary: String,
}

#[derive(Clone, CandidType, Default, Serialize, Deserialize, PartialEq)]
pub struct ProposalId {
    pub id: u64,
}

async fn fetch_proposals() -> Result<Vec<NNSProposal>, String> {
    #[derive(CandidType, Serialize, Deserialize)]
    pub struct ListProposalInfo {
        pub limit: u32,
        pub before_proposal: Option<ProposalId>,
        pub exclude_topic: Vec<i32>,
        pub include_reward_status: Vec<i32>,
        pub include_status: Vec<i32>,
    }

    #[derive(CandidType, Serialize, Deserialize)]
    pub struct ListProposalInfoResponse {
        pub proposal_info: Vec<ProposalInfo>,
    }

    #[derive(CandidType, Serialize, Deserialize)]
    pub struct ProposalStruct {
        pub title: Option<String>,
        pub summary: String,
    }

    #[derive(CandidType, Serialize, Deserialize)]
    pub struct ProposalInfo {
        pub id: Option<ProposalId>,
        pub proposer: Option<NeuronId>,
        pub proposal: Option<ProposalStruct>,
        pub topic: i32,
    }

    let args = ListProposalInfo {
        include_reward_status: Default::default(),
        before_proposal: Default::default(),
        limit: 25,
        exclude_topic: Default::default(),
        include_status: Default::default(),
    };
    let (response,): (ListProposalInfoResponse,) =
        call_canister(MAINNET_GOVERNANCE_CANISTER_ID, "list_proposals", (args,))
            .await
            .map_err(|err| format!("couldn't call governance canister: {:?}", err))?;

    Ok(response
        .proposal_info
        .into_iter()
        .filter_map(|i| {
            i.proposal.as_ref().map(|p| NNSProposal {
                id: i.id.clone().unwrap_or_default().id,
                title: p.title.clone().unwrap_or_default(),
                summary: p.summary.clone(),
                topic: i.topic,
                proposer: i.proposer.as_ref().expect("no neuron found").id,
            })
        })
        .collect())
}

/// Fetches new nns proposal, rejects those that we don't vote on and publishes other ones on
/// Taggr via the @XBot (TODO: remove Xbot as dependency).
pub async fn work(now: u64) {
    // Vote on proposals if pending ones exist
    for (proposal_id, post_id) in read(|state| state.pending_nns_proposals.clone()) {
        if let Some(Extension::Poll(poll)) = read(|state| {
            Post::get(state, &post_id).and_then(|post| post.extension.as_ref().cloned())
        }) {
            // The poll is still pending.
            if read(|state| state.pending_polls.contains(&post_id)) {
                continue;
            }

            let adopted = poll.weighted_by_tokens.get(&0).copied().unwrap_or_default();
            let rejected = poll.weighted_by_tokens.get(&1).copied().unwrap_or_default();
            if let Err(err) = vote_on_nns_proposal(
                proposal_id,
                if adopted > rejected {
                    NNSVote::Adopt
                } else {
                    NNSVote::Reject
                },
            )
            .await
            {
                mutate(|state| {
                    state.logger.warn(format!(
                        "couldn't vote on NNS proposal {}: {}",
                        proposal_id, err
                    ))
                });
            };
        }
        mutate(|state| state.pending_nns_proposals.remove(&proposal_id));
    }

    // fetch new proposals
    let last_known_proposal_id = read(|state| state.last_nns_proposal);
    let proposals = match fetch_proposals().await {
        Ok(value) => value,
        Err(err) => {
            mutate(|state| {
                state
                    .logger
                    .warn(format!("couldn't fetch proposals: {}", err))
            });
            Default::default()
        }
    };

    for proposal in proposals
        .into_iter()
        .filter(|proposal| proposal.id > last_known_proposal_id)
    {
        // Vote only on proposals with topics governance, SNS & replica-management.
        if [4, 14].contains(&proposal.topic) {
            let post = format!(
                    "# #NNS-Proposal [{0}](https://dashboard.internetcomputer.org/proposal/{0})\n## {1}\n",
                    proposal.id, proposal.title,
                ) + &format!(
                    "Proposer: [{0}](https://dashboard.internetcomputer.org/neuron/{0})\n\n\n\n{1}",
                    proposal.proposer, proposal.summary
                );

            let result = mutate(|state| {
                state.last_nns_proposal = state.last_nns_proposal.max(proposal.id);
                Post::create(
                    state,
                    post,
                    Default::default(),
                    id(),
                    now,
                    None,
                    Some("NNS-GOV".into()),
                    Some(Extension::Poll(Poll {
                        deadline: 72,
                        options: vec!["ACCEPT".into(), "REJECT".into()],
                        ..Default::default()
                    })),
                )
            });

            match result {
                Ok(post_id) => {
                    mutate(|state| state.pending_nns_proposals.insert(proposal.id, post_id));
                    continue;
                }
                Err(err) => {
                    mutate(|state| {
                        state.logger.warn(format!(
                            "couldn't create an NNS proposal post for proposal {}: {:?}",
                            proposal.id, err
                        ))
                    });
                }
            };
        }

        if let Err(err) = vote_on_nns_proposal(proposal.id, NNSVote::Reject).await {
            mutate(|state| {
                state.last_nns_proposal = state.last_nns_proposal.max(proposal.id);
                state.logger.warn(format!(
                    "couldn't vote on NNS proposal {}: {}",
                    proposal.id, err
                ))
            });
        };
    }
}

async fn vote_on_nns_proposal(proposal_id: u64, vote: NNSVote) -> Result<(), String> {
    #[derive(CandidType, Serialize)]
    enum Command {
        RegisterVote {
            vote: i32,
            proposal: Option<ProposalId>,
        },
    }
    #[derive(CandidType, Serialize)]
    struct NnsVoteArgs {
        id: Option<ProposalId>,
        command: Option<Command>,
    }
    let args = NnsVoteArgs {
        id: Some(ProposalId {
            id: CONFIG.neuron_id,
        }),
        command: Some(Command::RegisterVote {
            vote: vote as i32,
            proposal: Some(ProposalId { id: proposal_id }),
        }),
    };
    let encoded_args = candid::utils::encode_one(args).expect("failed to encode args");

    let method = "manage_neuron";
    // Sometimes we can't vote because the governance canister gets an upgrade,
    // so we try at most 10 times
    let mut attempts: i16 = 10;
    loop {
        let result = call_canister_raw(MAINNET_GOVERNANCE_CANISTER_ID, method, &encoded_args).await;

        attempts -= 1;

        if result.is_ok() || attempts <= 0 {
            return result
                .map(|_| ())
                .map_err(|err| format!("couldn't call the governance canister: {:?}", err));
        }
    }
}
