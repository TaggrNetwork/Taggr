use std::collections::BTreeMap;

use crate::token::Token;

use super::Credits;
use candid::CandidType;
use serde::Serialize;

pub const ICP_CYCLES_PER_XDR: u64 = 1_000_000_000_000;

#[derive(CandidType, Serialize)]
pub struct Config {
    pub name: &'static str,
    pub domains: &'static [&'static str],
    pub logo: &'static str,
    pub staging: &'static str,

    pub nns_voting_enabled: bool,

    pub transaction_fee: u64,
    pub credit_transaction_fee: u64,
    pub token_decimals: u8,
    pub token_symbol: &'static str,
    pub maximum_supply: Token,

    pub max_age_hot_post_days: u64,

    pub downvote_counting_period_days: u64,

    pub credits_per_xdr: u64,

    pub individual_minting_threshold_percentage: u64,
    pub minting_threshold_percentage: u64,

    pub active_user_share_for_minting_promille: u32,

    pub min_treasury_balance_xdrs: u64,

    pub supply_threshold_for_transfer_percentage: u64,

    pub user_report_validity_days: u64,

    pub proposal_approval_threshold: u16,
    pub proposal_controversy_threashold: u16,
    pub proposal_rejection_penalty: Credits,

    pub max_report_length: usize,

    pub post_heat_token_balance_cap: Token,

    pub max_credits_mint_kilos: u64,

    // When there are less tokens than defined by this threshold, only the user karma is used to
    // determine the number of minted tokens.
    pub boostrapping_threshold_tokens: u64,

    pub max_spendable_tokens: Token,

    pub dao_realm: &'static str,

    pub max_realm_cleanup_penalty: Credits,

    pub realm_revenue_percentage: u32,

    pub main_canister_min_cycle_balance: u64,

    pub child_canister_min_cycle_balance: u64,

    pub max_bucket_size: u64,

    pub max_posts_per_day: usize,
    pub max_comments_per_hour: usize,
    pub excess_penalty: Credits,

    pub feed_page_size: usize,

    pub reporting_penalty_post: Credits,
    pub reporting_penalty_misbehaviour: Credits,

    pub minimal_tip: Credits,

    pub num_hot_posts: usize,

    pub post_cost: Credits,
    pub blob_cost: Credits,
    pub poll_cost: Credits,
    pub realm_cost: Credits,

    pub poll_revote_deadline_hours: u64,

    pub name_change_cost: Credits,

    pub max_realm_name: usize,
    pub max_realm_logo_len: usize,

    pub response_reward: Credits,

    pub inactivity_penalty: Credits,
    pub inactivity_duration_weeks: u64,

    // top x percentage of users selected as stalwarts
    pub stalwart_percentage: usize,
    pub min_stalwart_activity_weeks: u8,
    pub min_stalwart_account_age_weeks: u8,
    pub stalwart_moderation_reward: Credits,

    // percentage of stalwarts needed to confirm a report
    pub report_confirmation_percentage: u16,

    pub max_post_length: usize,
    pub max_tag_length: usize,
    pub max_user_info_length: usize,
    pub max_blob_size_bytes: usize,

    pub min_credits_for_inviting: Credits,

    pub online_activity_minutes: u64,

    pub voting_power_activity_weeks: u64,

    pub reactions: &'static [(u16, i64)],

    pub min_positive_reaction_id: u16,

    pub reaction_fee: &'static [(u16, Credits)],

    pub max_funding_amount: u64,

    pub post_deletion_penalty_factor: u32,

    #[serde(with = "string")]
    pub neuron_id: u64,
}

mod string {
    use serde::Serializer;
    use std::fmt::Display;

    pub fn serialize<T, S>(value: &T, serializer: S) -> Result<S::Ok, S::Error>
    where
        T: Display,
        S: Serializer,
    {
        serializer.collect_str(value)
    }
}

pub const CONFIG: &Config = &Config {
    name: "Taggr",
    domains: &[
        "taggr.link",
        "taggr.network",
        "taggr.club",
        "taggr.blog",
        "taggr.wtf",
        "6qfxa-ryaaa-aaaai-qbhsq-cai.icp0.io",
        "6qfxa-ryaaa-aaaai-qbhsq-cai.ic0.app",
    ],
    logo: include_str!("../../frontend/assets/logo.min.svg"),
    staging: "e4i5g-biaaa-aaaao-ai7ja-cai.icp0.io",

    #[cfg(not(feature = "staging"))]
    token_symbol: "TAGGR",
    #[cfg(feature = "staging")]
    token_symbol: "STAGG",
    token_decimals: 2,
    transaction_fee: 25,
    credit_transaction_fee: 1,

    credits_per_xdr: 1000,

    max_report_length: 3000,

    post_heat_token_balance_cap: 5,

    boostrapping_threshold_tokens: 100000,

    #[cfg(test)]
    max_spendable_tokens: 12000000,
    #[cfg(not(test))]
    max_spendable_tokens: 120000,

    min_treasury_balance_xdrs: 38, // ~$50

    individual_minting_threshold_percentage: 1,
    minting_threshold_percentage: 5,

    active_user_share_for_minting_promille: 10,

    max_age_hot_post_days: 2,

    downvote_counting_period_days: 7,

    max_credits_mint_kilos: 10,

    #[cfg(not(any(feature = "dev", feature = "staging")))]
    supply_threshold_for_transfer_percentage: 20,
    #[cfg(feature = "staging")]
    supply_threshold_for_transfer_percentage: 0,
    #[cfg(feature = "dev")]
    supply_threshold_for_transfer_percentage: 10,

    user_report_validity_days: 90,

    #[cfg(not(any(feature = "dev", feature = "staging")))]
    nns_voting_enabled: true,
    #[cfg(any(feature = "dev", feature = "staging"))]
    nns_voting_enabled: false,

    dao_realm: "DAO",

    realm_revenue_percentage: 5,

    #[cfg(feature = "dev")]
    proposal_approval_threshold: 1,
    #[cfg(not(feature = "dev"))]
    proposal_approval_threshold: 66,
    proposal_controversy_threashold: 10,

    #[cfg(not(feature = "staging"))]
    proposal_rejection_penalty: 500,
    #[cfg(feature = "staging")]
    proposal_rejection_penalty: 50,

    maximum_supply: 100_000_000,

    #[cfg(not(feature = "staging"))]
    main_canister_min_cycle_balance: 10 * ICP_CYCLES_PER_XDR,
    #[cfg(not(feature = "staging"))]
    child_canister_min_cycle_balance: 10 * ICP_CYCLES_PER_XDR,

    #[cfg(feature = "staging")]
    main_canister_min_cycle_balance: 2 * ICP_CYCLES_PER_XDR,
    #[cfg(feature = "staging")]
    child_canister_min_cycle_balance: 2 * ICP_CYCLES_PER_XDR,

    num_hot_posts: 10000,

    #[cfg(feature = "dev")]
    report_confirmation_percentage: 1,
    #[cfg(test)]
    report_confirmation_percentage: 15,
    #[cfg(not(any(test, feature = "dev")))]
    report_confirmation_percentage: 20,

    minimal_tip: 1,

    max_realm_cleanup_penalty: 500,

    max_bucket_size: 1024 * 1024 * 1024 * 96, // 96Gb

    #[cfg(any(test, feature = "dev"))]
    max_posts_per_day: 150,
    #[cfg(not(any(test, feature = "dev")))]
    max_posts_per_day: 5,
    max_comments_per_hour: 20,
    excess_penalty: 5,

    feed_page_size: 30,

    reporting_penalty_post: 200,
    reporting_penalty_misbehaviour: 1000,

    min_credits_for_inviting: 50,

    post_cost: 2,
    blob_cost: 20,
    poll_cost: 3,
    realm_cost: 1000,

    poll_revote_deadline_hours: 4,

    name_change_cost: 1000,

    max_realm_name: 25,
    max_realm_logo_len: 16 * 1024,

    post_deletion_penalty_factor: 10,

    response_reward: 1,

    inactivity_penalty: 45,
    inactivity_duration_weeks: 26,
    voting_power_activity_weeks: 2,

    stalwart_percentage: 3,
    #[cfg(feature = "staging")]
    min_stalwart_activity_weeks: 1,
    #[cfg(not(feature = "staging"))]
    min_stalwart_activity_weeks: 6,

    #[cfg(feature = "staging")]
    min_stalwart_account_age_weeks: 1,
    #[cfg(not(feature = "staging"))]
    min_stalwart_account_age_weeks: 26,

    stalwart_moderation_reward: 20,

    max_post_length: 15000,
    max_tag_length: 30,
    max_user_info_length: 500,
    max_blob_size_bytes: 460800,

    online_activity_minutes: 10 * 60000000000_u64,

    reactions: &[
        // sad, thumb up, heart
        (11, 2),
        (10, 2),
        (12, 2),
        // rocket, 100, joy, flame,
        (53, 10),
        (52, 10),
        (51, 10),
        (50, 10),
        // thumb down
        // star, pirate
        (100, 20),
        (101, 20),
        (1, -3),
    ],

    min_positive_reaction_id: 10,

    reaction_fee: &[
        (100, 3),
        (101, 3),
        (50, 2),
        (51, 2),
        (52, 2),
        (53, 2),
        (10, 1),
        (11, 1),
        (12, 1),
    ],

    max_funding_amount: 1_000_000, // at ratio 1:1

    neuron_id: 16737374299031693047,
};

pub fn reaction_rewards() -> BTreeMap<u16, i64> {
    CONFIG
        .reactions
        .iter()
        .fold(BTreeMap::default(), |mut acc, (id, rewards)| {
            acc.insert(*id, *rewards);
            acc
        })
}

pub fn reaction_fee(reaction: u16) -> Credits {
    CONFIG
        .reaction_fee
        .iter()
        .find_map(|(id, fee)| (id == &reaction).then_some(*fee))
        .expect("unexpected reaction")
}
